import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"

import {
  buildRepairPrompt,
  errorMessage,
  isRecord,
  normalizeReview,
  OperationalError,
  parseJsonObject,
  type Review,
} from "./core.ts"

export const ACPX_PACKAGE = "acpx@0.13.0"
export const AVAILABLE_AGENTS = ["claude", "codex", "opencode", "pi"] as const
export type AgentName = (typeof AVAILABLE_AGENTS)[number]

export const REVIEWER_COMMANDS = {
  claude: "npx -y @agentclientprotocol/claude-agent-acp@0.60.0",
  codex: "npx -y @agentclientprotocol/codex-acp@1.3.0",
  opencode: "npx -y opencode-ai@1.18.18 acp",
  pi: "npx -y pi-acp@0.0.33",
} as const satisfies Record<AgentName, string>

const MAX_PARSE_ATTEMPTS = 2
const MIN_PARSE_REPAIR_MS = 30_000
const TIMEOUT_CANCEL_GRACE_MS = 5_000

class ReviewDeadlineError extends OperationalError {
  constructor(message: string) {
    super("timeout", message)
    this.name = "ReviewDeadlineError"
  }
}

export type CommandResult = {
  stdout: string
  stderr: string
}

export type RunAcpx = (
  args: string[],
  input: string | undefined,
  timeoutMs: number,
) => Promise<CommandResult>

export type AcpxReview = Review & { session_id: string }

export function validateAgentOptions(
  agent: AgentName,
  options: { reasoning?: string },
): void {
  if (agent === "opencode" && options.reasoning !== undefined) {
    throw new OperationalError(
      "invalid_input",
      `--reasoning is not supported for --agent opencode through ${ACPX_PACKAGE}.`,
    )
  }
}

export async function requestReview(options: {
  agent: AgentName
  prompt: string
  timeoutSeconds: number
  resumeSessionId?: string
  model?: string
  reasoning?: string
  cwd: string
  runAcpx?: RunAcpx
  createSessionName?: () => string
}): Promise<AcpxReview> {
  const {
    agent,
    prompt,
    timeoutSeconds,
    resumeSessionId,
    model,
    reasoning,
    cwd,
    runAcpx = runAcpxCommand,
    createSessionName = () => `agent-review-${randomBytes(8).toString("hex")}`,
  } = options
  const deadline = performance.now() + timeoutSeconds * 1_000
  const sessionId = resumeSessionId ?? createSessionName()

  try {
    if (resumeSessionId === undefined) {
      const createArgs = [...baseAcpxArgs(cwd, "quiet")]
      if (model !== undefined) createArgs.push("--model", model)
      await runAcpx(
        [
          ...createArgs,
          ...agentSelectionArgs(agent),
          "sessions",
          "new",
          "--name",
          sessionId,
        ],
        undefined,
        remainingMs(deadline),
      )
    }

    if (reasoning !== undefined) {
      await configureReasoning({
        agent,
        reasoning,
        sessionId,
        cwd,
        deadline,
        runAcpx,
      })
    }

    let currentPrompt = prompt
    let parseFailure:
      | { attempts: number; message: string; rawOutput: string }
      | undefined
    for (let attempt = 1; attempt <= MAX_PARSE_ATTEMPTS; attempt += 1) {
      let result: CommandResult
      try {
        const commandBudgetMs = remainingMs(deadline)
        const promptArgs = [
          "--cwd",
          cwd,
          "--format",
          "quiet",
          "--approve-all",
          "--suppress-reads",
        ]
        if (model !== undefined) promptArgs.push("--model", model)
        promptArgs.push(
          "--timeout",
          String(Math.max(1, Math.ceil(commandBudgetMs / 1_000))),
          ...agentSelectionArgs(agent),
          "prompt",
          "-s",
          sessionId,
          "-f",
          "-",
        )

        result = await runAcpx(promptArgs, currentPrompt, commandBudgetMs)
      } catch (error) {
        if (
          parseFailure !== undefined &&
          error instanceof OperationalError &&
          error.reason === "timeout"
        ) {
          await cancelTimedOutReview({ agent, sessionId, cwd, runAcpx })
          throw malformedReviewError(
            agent,
            parseFailure,
            "The structured-output repair attempt did not complete before the round deadline.",
          )
        }
        throw error
      }

      try {
        const review = normalizeReview(parseJsonObject(result.stdout))
        return { ...review, session_id: sessionId }
      } catch (error) {
        parseFailure = {
          attempts: attempt,
          message: errorMessage(error),
          rawOutput: result.stdout,
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
  } catch (error) {
    if (error instanceof OperationalError && error.reason === "timeout") {
      await cancelTimedOutReview({ agent, sessionId, cwd, runAcpx })
      if (error instanceof ReviewDeadlineError) {
        throw new OperationalError(
          "timeout",
          `Agent '${agent}' review exceeded the configured timeout of ${timeoutSeconds} seconds.`,
        )
      }
    }
    throw error
  }
}

export async function runAcpxCommand(
  args: string[],
  input: string | undefined,
  timeoutMs: number,
): Promise<CommandResult> {
  if (timeoutMs <= 0) {
    throw new ReviewDeadlineError("The acpx command exceeded its deadline.")
  }

  return await new Promise((resolve, reject) => {
    const child = spawn("npx", ["-y", ACPX_PACKAGE, ...args], {
      stdio: ["pipe", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    let timedOut = false
    let spawnError: Error | undefined
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined
    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGTERM")
      forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 1_000)
    }, timeoutMs)

    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk
    })
    child.on("error", (error) => {
      spawnError = error
    })
    child.stdin.on("error", () => {
      // A fast process failure can close stdin before the buffered prompt is written.
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      if (forceKillTimer !== undefined) clearTimeout(forceKillTimer)
      if (timedOut) {
        reject(
          new ReviewDeadlineError("The acpx command exceeded its deadline."),
        )
        return
      }
      if (spawnError !== undefined) {
        reject(classifyFailure(errorMessage(spawnError)))
        return
      }
      if (code !== 0) {
        reject(
          classifyFailure(
            stderr.trim() || stdout.trim() || "unknown error",
            code,
          ),
        )
        return
      }
      resolve({ stdout, stderr })
    })
    child.stdin.end(input)
  })
}

export function classifyFailure(
  message: string,
  exitCode?: number | null,
): OperationalError {
  if (
    /not logged in|unauthori[sz]ed|authentication failed|missing api key|no api key|login required|auth(?:entication)?[ _]required/i.test(
      message,
    )
  ) {
    return new OperationalError("auth_unavailable", message)
  }
  if (
    /eperm|eacces|operation not permitted|permission denied/i.test(message) &&
    /\.acpx|\.npm|\.pi|\.claude|\.codex|opencode/i.test(message)
  ) {
    return new OperationalError("sandbox_restriction", message)
  }
  if (
    /enotfound|eai_again|network|could not resolve|unable to resolve|cache mode|spawn npx enoent/i.test(
      message,
    )
  ) {
    return new OperationalError("dependency_unavailable", message)
  }
  if (exitCode === 3) {
    return new OperationalError("timeout", message)
  }
  return new OperationalError("agent_cli_failed", message)
}

async function cancelTimedOutReview(options: {
  agent: AgentName
  sessionId: string
  cwd: string
  runAcpx: RunAcpx
}): Promise<void> {
  const { agent, sessionId, cwd, runAcpx } = options
  try {
    await runAcpx(
      [
        ...baseAcpxArgs(cwd, "quiet"),
        ...agentSelectionArgs(agent),
        "cancel",
        "-s",
        sessionId,
      ],
      undefined,
      TIMEOUT_CANCEL_GRACE_MS,
    )
  } catch {
    // Preserve the original timeout after a bounded best-effort cancellation.
  }
}

async function configureReasoning(options: {
  agent: AgentName
  reasoning: string
  sessionId: string
  cwd: string
  deadline: number
  runAcpx: RunAcpx
}): Promise<void> {
  const { agent, reasoning, sessionId, cwd, deadline, runAcpx } = options
  const metadataResult = await runAcpx(
    [
      ...baseAcpxArgs(cwd, "json"),
      ...agentSelectionArgs(agent),
      "sessions",
      "show",
      sessionId,
    ],
    undefined,
    remainingMs(deadline),
  )
  const metadata = parseJsonObject(metadataResult.stdout)
  const acpx = metadata.acpx
  const configOptions = isRecord(acpx) ? acpx.config_options : undefined
  const thoughtOption = Array.isArray(configOptions)
    ? configOptions.find(
        (option) =>
          isRecord(option) &&
          option.category === "thought_level" &&
          typeof option.id === "string",
      )
    : undefined
  if (!isRecord(thoughtOption) || typeof thoughtOption.id !== "string") {
    throw new OperationalError(
      "invalid_input",
      `--reasoning is not supported for --agent ${agent} through ${ACPX_PACKAGE}.`,
    )
  }

  const choices = Array.isArray(thoughtOption.options)
    ? thoughtOption.options
        .filter(
          (choice) => isRecord(choice) && typeof choice.value === "string",
        )
        .map((choice) => String(choice.value))
    : []
  if (choices.length > 0 && !choices.includes(reasoning)) {
    throw new OperationalError(
      "invalid_input",
      `Unsupported --reasoning value '${reasoning}' for ${agent}. Available values: ${choices.join(", ")}.`,
    )
  }

  await runAcpx(
    [
      ...baseAcpxArgs(cwd, "quiet"),
      ...agentSelectionArgs(agent),
      "set",
      thoughtOption.id,
      reasoning,
      "-s",
      sessionId,
    ],
    undefined,
    remainingMs(deadline),
  )
}

function baseAcpxArgs(cwd: string, format: "quiet" | "json"): string[] {
  return ["--cwd", cwd, "--format", format]
}

function agentSelectionArgs(agent: AgentName): string[] {
  return ["--agent", REVIEWER_COMMANDS[agent]]
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
