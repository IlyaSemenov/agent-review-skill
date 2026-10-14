import { realpath, stat } from "node:fs/promises"

import type { ProviderConfig, TurnResult } from "@agentex/agent"

import {
  buildRepairPrompt,
  errorMessage,
  normalizeReview,
  OperationalError,
  parseJsonObject,
  type Review,
} from "./core.ts"
import { loadAgentex } from "./runtime.ts"

export const AVAILABLE_AGENTS = ["claude", "codex", "opencode", "pi"] as const
export type AgentName = (typeof AVAILABLE_AGENTS)[number]

export const REASONING_CONFIG_KEYS = {
  claude: "effort",
  codex: "effort",
  opencode: "modelVariant",
  pi: "thinking",
} as const satisfies Record<AgentName, keyof ProviderConfig>

/** Reviewers that run inside a read-only OS sandbox instead of with every tool permission approved. */
export const SANDBOXED_AGENTS: ReadonlySet<AgentName> = new Set([
  "claude",
  "codex",
])

const MAX_PARSE_ATTEMPTS = 2
const MIN_PARSE_REPAIR_MS = 30_000
const SESSION_CLOSE_GRACE_MS = 5_000
const TURN_TIMEOUT_GRACE_MS = 5_000
const STDERR_TAIL_CHARS = 4_000
const PERMISSION_FAILURE =
  /eperm|eacces|operation not permitted|permission denied/i

class ReviewDeadlineError extends OperationalError {
  constructor(message: string) {
    super("timeout", message)
    this.name = "ReviewDeadlineError"
  }
}

export type ReviewerSession = {
  readonly sessionId: string | null
  send(prompt: string, timeoutSec: number): Promise<TurnResult>
  close(): Promise<void>
}

export type OpenReviewerSession = (options: {
  cwd: string
  sessionId: string | undefined
  config: ProviderConfig
  sandboxed: boolean
}) => Promise<ReviewerSession>

export type LoadReviewer = (
  agent: AgentName,
  timeoutMs: number,
) => Promise<OpenReviewerSession>

export type AgentexReview = Review & { session_id: string }

export async function requestReview(options: {
  agent: AgentName
  prompt: string
  timeoutSeconds: number
  resumeSessionId?: string
  model?: string
  reasoning?: string
  cwd: string
  loadReviewer?: LoadReviewer
}): Promise<AgentexReview> {
  const {
    agent,
    prompt,
    timeoutSeconds,
    resumeSessionId,
    model,
    reasoning,
    cwd,
    loadReviewer = loadAgentexReviewer,
  } = options
  const deadline = performance.now() + timeoutSeconds * 1_000

  try {
    let openSession: OpenReviewerSession
    try {
      openSession = await loadReviewer(agent, remainingMs(deadline))
    } catch (error) {
      if (error instanceof OperationalError) throw error
      const message = errorMessage(error)
      throw new OperationalError(
        PERMISSION_FAILURE.test(message)
          ? "sandbox_restriction"
          : "dependency_unavailable",
        message,
      )
    }

    const config: ProviderConfig = {
      ...(await permissionConfig(agent, cwd)),
      model,
    }
    if (reasoning !== undefined)
      config[REASONING_CONFIG_KEYS[agent]] = reasoning

    if (
      agent === "pi" &&
      resumeSessionId !== undefined &&
      !(await hasSavedConversation(resumeSessionId))
    ) {
      throw sessionLostError(agent, resumeSessionId)
    }

    // agentex does not bound session startup: https://github.com/dynamismlabs/agentex/issues/8
    const startupBudgetMs = remainingMs(deadline)
    let session: ReviewerSession
    try {
      session = await withDeadline(
        openSession({
          cwd,
          sessionId: resumeSessionId,
          config,
          sandboxed: SANDBOXED_AGENTS.has(agent),
        }),
        startupBudgetMs,
        (lateSession) => void closeSession(lateSession),
      )
    } catch (error) {
      if (error instanceof OperationalError) throw error
      throw classifyFailure(errorMessage(error))
    }
    try {
      // Codex replaces a missing thread already during startup: https://github.com/dynamismlabs/agentex/issues/6
      if (
        resumeSessionId !== undefined &&
        session.sessionId !== null &&
        session.sessionId !== resumeSessionId
      ) {
        throw sessionLostError(
          agent,
          resumeSessionId,
          "The reviewer resumed into a different session.",
        )
      }
      return await reviewInSession({
        agent,
        session,
        prompt,
        resumeSessionId,
        deadline,
      })
    } finally {
      await closeSession(session)
    }
  } catch (error) {
    if (error instanceof ReviewDeadlineError) {
      throw new OperationalError(
        "timeout",
        `Agent '${agent}' review exceeded the configured timeout of ${timeoutSeconds} seconds.`,
      )
    }
    throw error
  }
}

async function reviewInSession(options: {
  agent: AgentName
  session: ReviewerSession
  prompt: string
  resumeSessionId: string | undefined
  deadline: number
}): Promise<AgentexReview> {
  const { agent, session, prompt, resumeSessionId, deadline } = options
  let currentPrompt = prompt
  let parseFailure:
    | { attempts: number; message: string; rawOutput: string }
    | undefined
  for (let attempt = 1; attempt <= MAX_PARSE_ATTEMPTS; attempt += 1) {
    let output: string
    let sessionId: string
    try {
      ;({ output, sessionId } = await sendTurn({
        agent,
        session,
        prompt: currentPrompt,
        resumeSessionId,
        deadline,
      }))
    } catch (error) {
      if (
        parseFailure !== undefined &&
        error instanceof OperationalError &&
        error.reason === "timeout"
      ) {
        throw malformedReviewError(
          agent,
          parseFailure,
          "The structured-output repair attempt did not complete before the round deadline.",
        )
      }
      throw error
    }

    try {
      const review = normalizeReview(parseJsonObject(output))
      return { ...review, session_id: sessionId }
    } catch (error) {
      parseFailure = {
        attempts: attempt,
        message: errorMessage(error),
        rawOutput: output,
      }
    }

    if (attempt === MAX_PARSE_ATTEMPTS)
      throw malformedReviewError(agent, parseFailure)

    if (millisecondsUntil(deadline) < MIN_PARSE_REPAIR_MS) {
      throw malformedReviewError(
        agent,
        parseFailure,
        `The structured-output repair attempt was skipped because fewer than ${MIN_PARSE_REPAIR_MS / 1_000} seconds remained.`,
      )
    }
    currentPrompt = buildRepairPrompt(parseFailure.message)
  }

  throw new Error("Unreachable parse-attempt state")
}

async function sendTurn(options: {
  agent: AgentName
  session: ReviewerSession
  prompt: string
  resumeSessionId: string | undefined
  deadline: number
}): Promise<{ output: string; sessionId: string }> {
  const { agent, session, prompt, resumeSessionId, deadline } = options
  let result: TurnResult
  try {
    const turnBudgetMs = remainingMs(deadline)
    // Gives agentex time to interrupt the turn and report its own timeout first.
    result = await withDeadline(
      session.send(prompt, Math.max(1, Math.ceil(turnBudgetMs / 1_000))),
      turnBudgetMs + TURN_TIMEOUT_GRACE_MS,
    )
  } catch (error) {
    if (error instanceof OperationalError) throw error
    throw classifyFailure(errorMessage(error))
  }

  if (result.status === "timeout")
    throw new ReviewDeadlineError("The reviewer turn exceeded its deadline.")
  if (result.status !== "completed") {
    const failure = classifyTurnResult(result)
    // OpenCode reports a missing resumed session only as an HTTP status: https://github.com/dynamismlabs/agentex/issues/6
    if (
      agent === "opencode" &&
      resumeSessionId !== undefined &&
      /request failed \(404\)/i.test(failure.message)
    ) {
      throw sessionLostError(agent, resumeSessionId, failure.message)
    }
    throw failure
  }

  const sessionId = session.sessionId
  if (!sessionId) {
    throw new OperationalError(
      "agent_cli_failed",
      `Agent '${agent}' did not report a session id.`,
    )
  }
  // Guards against a silently replaced session until agentex offers strict resume: https://github.com/dynamismlabs/agentex/issues/6
  if (resumeSessionId !== undefined && sessionId !== resumeSessionId) {
    throw sessionLostError(
      agent,
      resumeSessionId,
      "The reviewer answered in a new session without the previous review context.",
    )
  }
  return { output: result.summary ?? "", sessionId }
}

export function classifyTurnResult(result: TurnResult): OperationalError {
  const message =
    result.errorMessage?.trim() ||
    result.summary?.trim() ||
    `Reviewer finished with status '${result.status}'.`
  if (result.errorCode === "auth_required")
    return new OperationalError("auth_unavailable", message)
  return classifyFailure(message)
}

export function classifyFailure(message: string): OperationalError {
  // Matches CLI text until agentex reports a dedicated error code: https://github.com/dynamismlabs/agentex/issues/5
  if (/no conversation found|session.{0,40}not found/i.test(message)) {
    return new OperationalError("session_lost", message)
  }
  if (/could not find ".+" binary/i.test(message)) {
    return new OperationalError("agent_cli_unavailable", message)
  }
  if (
    /not logged in|unauthori[sz]ed|authentication failed|missing api key|no api key|login required|auth(?:entication)?[ _]required/i.test(
      message,
    )
  ) {
    return new OperationalError("auth_unavailable", message)
  }
  if (
    PERMISSION_FAILURE.test(message) &&
    /\.pi|\.claude|\.codex|opencode/i.test(message)
  ) {
    return new OperationalError("sandbox_restriction", message)
  }
  if (
    /enotfound|eai_again|network|could not resolve|unable to resolve/i.test(
      message,
    )
  ) {
    return new OperationalError("dependency_unavailable", message)
  }
  return new OperationalError("agent_cli_failed", message)
}

async function loadAgentexReviewer(
  agent: AgentName,
  timeoutMs: number,
): Promise<OpenReviewerSession> {
  const agentex = await loadAgentex({ timeoutMs })
  const provider = agentex.getProvider(agent)
  // Sessions replace `execute()`, which returns an empty pi turn: https://github.com/dynamismlabs/agentex/issues/4
  const createSession = provider.createSession?.bind(provider)
  if (createSession === undefined) {
    throw new Error(`Provider '${agent}' does not support sessions.`)
  }
  return async ({ cwd, sessionId, config, sandboxed }) => {
    let stderr = ""
    const session = await createSession({
      cwd,
      config,
      sessionParams: sessionId === undefined ? null : { sessionId, cwd },
      // agentex approves every request when no handler is supplied: https://github.com/dynamismlabs/agentex/issues/9
      onUserInputRequest: sandboxed
        ? async () => ({ allow: false })
        : undefined,
      onOutput: (stream, chunk) => {
        if (stream === "stderr")
          stderr = (stderr + chunk).slice(-STDERR_TAIL_CHARS)
      },
    })
    return {
      get sessionId() {
        return session.sessionId
      },
      send: async (prompt, timeoutSec) => {
        stderr = ""
        const result = await (await session.send(prompt, { timeoutSec })).result
        // Claude reports a missing resumed session only on stderr: https://github.com/dynamismlabs/agentex/issues/5
        if (result.status === "completed" || result.errorMessage) return result
        return { ...result, errorMessage: stderr.trim() || null }
      },
      close: () => session.close(),
    }
  }
}

/**
 * Builds the permission configuration for a reviewer.
 * Codex runs with a permissions profile that extends its read-only profile with network access, plus live web search.
 * Claude Code keeps only inspection and web tools and runs Bash in its OS sandbox with the working directory write-protected and no unsandboxed fallback.
 * Both keep network access.
 * OpenCode and pi have no read-only boundary and run with every tool permission approved.
 * agentex has no first-class read-only option, so the sandboxes are configured through `extraArgs`: https://github.com/dynamismlabs/agentex/issues/10
 */
export async function permissionConfig(
  agent: AgentName,
  cwd: string,
): Promise<ProviderConfig> {
  switch (agent) {
    case "codex":
      return {
        extraArgs: [
          "-c",
          'approval_policy="never"',
          "-c",
          'default_permissions="agent-review"',
          "-c",
          'permissions.agent-review.extends=":read-only"',
          "-c",
          "permissions.agent-review.network.enabled=true",
          "-c",
          'web_search="live"',
        ],
      }
    case "claude": {
      const sandbox = {
        enabled: true,
        failIfUnavailable: true,
        allowUnsandboxedCommands: false,
        filesystem: { disabled: false, denyWrite: [await realpath(cwd)] },
      }
      return {
        skipPermissions: true,
        strictMcpConfig: true,
        extraArgs: [
          "--tools",
          "Bash,Read,Grep,Glob,WebSearch,WebFetch",
          "--settings",
          JSON.stringify({ sandbox }),
        ],
      }
    }
    case "opencode":
    case "pi":
      return { skipPermissions: true }
  }
}

/**
 * Checks that a pi session file holds a saved conversation.
 * pi silently starts an empty conversation at a missing path, so the session id alone cannot reveal a lost session: https://github.com/dynamismlabs/agentex/issues/6
 */
async function hasSavedConversation(sessionPath: string): Promise<boolean> {
  try {
    return (await stat(sessionPath)).size > 0
  } catch {
    return false
  }
}

function sessionLostError(
  agent: AgentName,
  sessionId: string,
  detail?: string,
): OperationalError {
  const suffix = detail === undefined ? "" : `\n${detail}`
  return new OperationalError(
    "session_lost",
    `Agent '${agent}' could not resume session '${sessionId}'.${suffix}`,
  )
}

/**
 * Settles with the promise or rejects with a deadline error after `timeoutMs`.
 * A value that settles after the deadline is passed to `onLate` for cleanup.
 */
async function withDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onLate?: (value: T) => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let expired = false
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          expired = true
          reject(new ReviewDeadlineError("The review exceeded its deadline."))
        }, timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
    if (expired && onLate !== undefined) promise.then(onLate, () => {})
  }
}

async function closeSession(session: ReviewerSession): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      session.close(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, SESSION_CLOSE_GRACE_MS)
      }),
    ])
  } catch {
    // Preserve the review outcome after bounded best-effort cleanup.
  } finally {
    clearTimeout(timer)
  }
}

function malformedReviewError(
  agent: AgentName,
  failure: { attempts: number; message: string; rawOutput: string },
  detail?: string,
): OperationalError {
  const attempts = `${failure.attempts} attempt${failure.attempts === 1 ? "" : "s"}`
  const suffix = detail === undefined ? "" : `\n${detail}`
  return new OperationalError(
    "agent_cli_failed",
    `Agent '${agent}' returned malformed structured output after ${attempts}: ${failure.message}\nRaw output:\n${failure.rawOutput}${suffix}`,
  )
}

function millisecondsUntil(deadline: number): number {
  return Math.max(0, Math.ceil(deadline - performance.now()))
}

function remainingMs(deadline: number): number {
  const remaining = millisecondsUntil(deadline)
  if (remaining <= 0)
    throw new ReviewDeadlineError("The review exceeded its deadline.")
  return remaining
}
