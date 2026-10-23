import assert from "node:assert/strict"
import { realpathSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, test } from "node:test"

import type { ProviderConfig, TurnResult } from "@agentex/agent"

import {
  classifyFailure,
  classifyTurnResult,
  type LoadReviewer,
  permissionConfig,
  REASONING_CONFIG_KEYS,
  requestReview,
} from "./agentex.ts"
import { OperationalError } from "./core.ts"

const REPO = realpathSync(tmpdir())

function validPayload() {
  return {
    verdict: "approve",
    issues: [],
    open_questions: [],
    loop_signal: false,
    approval_reason: "looks good",
  }
}

function turnResult(overrides: Partial<TurnResult> = {}): TurnResult {
  return {
    summary: JSON.stringify(validPayload()),
    costUsd: null,
    status: "completed",
    errorCode: null,
    errorMessage: null,
    ...overrides,
  }
}

type SessionTrace = {
  opened: Array<{
    cwd: string
    sessionId?: string
    config: ProviderConfig
    sandboxed: boolean
  }>
  prompts: string[]
  closed: number
}

function fakeReviewer(
  respond: (prompt: string, call: number) => Partial<TurnResult>,
  sessionId: (requested: string | undefined) => string | null = (requested) =>
    requested ?? "native-1",
): { loadReviewer: LoadReviewer; trace: SessionTrace } {
  const trace: SessionTrace = { opened: [], prompts: [], closed: 0 }
  return {
    trace,
    loadReviewer: async () => async (options) => {
      trace.opened.push(options)
      return {
        sessionId: sessionId(options.sessionId),
        send: async (prompt) => {
          trace.prompts.push(prompt)
          return turnResult(respond(prompt, trace.prompts.length))
        },
        close: async () => {
          trace.closed += 1
        },
      }
    },
  }
}

describe("agentex orchestration", () => {
  test("starts a new session, returns its native id, and closes it", async () => {
    const reviewer = fakeReviewer(() => ({}))

    const review = await requestReview({
      agent: "claude",
      prompt: "review prompt",
      timeoutSeconds: 30,
      cwd: REPO,
      loadReviewer: reviewer.loadReviewer,
    })

    assert.equal(review.session_id, "native-1")
    assert.equal(reviewer.trace.opened[0]?.sessionId, undefined)
    assert.deepEqual(reviewer.trace.prompts, ["review prompt"])
    assert.equal(reviewer.trace.closed, 1)
  })

  test("fails when the working directory cannot be canonicalized", async () => {
    await assert.rejects(permissionConfig("claude", join(REPO, "missing")))
  })

  test("forwards model and reasoning to the reviewer configuration", async () => {
    const reviewer = fakeReviewer(() => ({}))
    await requestReview({
      agent: "pi",
      prompt: "review",
      timeoutSeconds: 30,
      model: "some/model",
      reasoning: "high",
      cwd: REPO,
      loadReviewer: reviewer.loadReviewer,
    })
    const config = reviewer.trace.opened[0]?.config
    assert.equal(config?.model, "some/model")
    assert.equal(config?.[REASONING_CONFIG_KEYS.pi], "high")
  })

  test("resumes the requested native session", async () => {
    const reviewer = fakeReviewer(() => ({}))

    const review = await requestReview({
      agent: "codex",
      prompt: "follow-up",
      timeoutSeconds: 30,
      resumeSessionId: "existing",
      cwd: REPO,
      loadReviewer: reviewer.loadReviewer,
    })

    assert.equal(review.session_id, "existing")
    assert.equal(reviewer.trace.opened[0]?.sessionId, "existing")
  })

  test("fails when the reviewer silently replaces a resumed session", async () => {
    const reviewer = fakeReviewer(
      () => ({}),
      () => "fresh",
    )

    await assert.rejects(
      requestReview({
        agent: "claude",
        prompt: "follow-up",
        timeoutSeconds: 30,
        resumeSessionId: "existing",
        cwd: REPO,
        loadReviewer: reviewer.loadReviewer,
      }),
      (error: unknown) =>
        error instanceof OperationalError && error.reason === "session_lost",
    )
    assert.deepEqual(reviewer.trace.prompts, [])
    assert.equal(reviewer.trace.closed, 1)
  })

  test("checks a resumed session id that is reported only after the turn", async () => {
    const make =
      (reportedAfterTurn: string): LoadReviewer =>
      async () =>
      async () => {
        let sent = false
        return {
          get sessionId() {
            return sent ? reportedAfterTurn : null
          },
          send: async () => {
            sent = true
            return turnResult()
          },
          close: async () => {},
        }
      }

    const review = await requestReview({
      agent: "opencode",
      prompt: "follow-up",
      timeoutSeconds: 30,
      resumeSessionId: "existing",
      cwd: REPO,
      loadReviewer: make("existing"),
    })
    assert.equal(review.session_id, "existing")

    await assert.rejects(
      requestReview({
        agent: "opencode",
        prompt: "follow-up",
        timeoutSeconds: 30,
        resumeSessionId: "existing",
        cwd: REPO,
        loadReviewer: make("fresh"),
      }),
      (error: unknown) =>
        error instanceof OperationalError && error.reason === "session_lost",
    )
  })

  test("fails before prompting when a resumed pi session file holds no conversation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-review-pi-"))
    try {
      const empty = join(directory, "empty.jsonl")
      await writeFile(empty, "")
      for (const sessionPath of [join(directory, "missing.jsonl"), empty]) {
        const reviewer = fakeReviewer(() => ({}))
        await assert.rejects(
          requestReview({
            agent: "pi",
            prompt: "follow-up",
            timeoutSeconds: 30,
            resumeSessionId: sessionPath,
            cwd: REPO,
            loadReviewer: reviewer.loadReviewer,
          }),
          (error: unknown) =>
            error instanceof OperationalError &&
            error.reason === "session_lost",
        )
        assert.equal(reviewer.trace.opened.length, 0)
      }

      const saved = join(directory, "saved.jsonl")
      await writeFile(saved, '{"type":"session"}\n')
      const reviewer = fakeReviewer(() => ({}))
      const review = await requestReview({
        agent: "pi",
        prompt: "follow-up",
        timeoutSeconds: 30,
        resumeSessionId: saved,
        cwd: REPO,
        loadReviewer: reviewer.loadReviewer,
      })
      assert.equal(review.session_id, saved)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("reports a resumed OpenCode session missing on the server as lost", async () => {
    const reviewer = fakeReviewer(() => ({
      status: "failed",
      errorCode: "http_error",
      errorMessage: "OpenCode message request failed (404)",
    }))

    await assert.rejects(
      requestReview({
        agent: "opencode",
        prompt: "follow-up",
        timeoutSeconds: 30,
        resumeSessionId: "ses_missing",
        cwd: REPO,
        loadReviewer: reviewer.loadReviewer,
      }),
      (error: unknown) =>
        error instanceof OperationalError && error.reason === "session_lost",
    )
  })

  test("bounds session startup by the round deadline", async () => {
    const startedAt = performance.now()
    await assert.rejects(
      requestReview({
        agent: "codex",
        prompt: "review",
        timeoutSeconds: 1,
        cwd: REPO,
        loadReviewer: async () => () => new Promise(() => {}),
      }),
      /exceeded the configured timeout of 1 seconds/,
    )
    assert.ok(performance.now() - startedAt < 3_000)
  })

  test("does not open a session after loading exhausts the round budget", async () => {
    const reviewer = fakeReviewer(() => ({}))
    await assert.rejects(
      requestReview({
        agent: "codex",
        prompt: "review",
        timeoutSeconds: 1,
        cwd: REPO,
        loadReviewer: async (agent, timeoutMs) => {
          await new Promise((resolve) => setTimeout(resolve, 1_100))
          return await reviewer.loadReviewer(agent, timeoutMs)
        },
      }),
      /exceeded the configured timeout of 1 seconds/,
    )
    assert.equal(reviewer.trace.opened.length, 0)
  })

  test("uses the same session for one JSON-repair retry", async () => {
    const reviewer = fakeReviewer((_prompt, call) =>
      call === 1 ? { summary: "not json" } : {},
    )

    const review = await requestReview({
      agent: "pi",
      prompt: "review",
      timeoutSeconds: 60,
      cwd: REPO,
      loadReviewer: reviewer.loadReviewer,
    })

    assert.equal(review.session_id, "native-1")
    assert.equal(reviewer.trace.opened.length, 1)
    assert.equal(reviewer.trace.prompts.length, 2)
    assert.match(reviewer.trace.prompts[1] ?? "", /did not match/)
  })

  test("reports malformed output when too little repair budget remains", async () => {
    const reviewer = fakeReviewer(() => ({ summary: "not json" }))

    await assert.rejects(
      requestReview({
        agent: "pi",
        prompt: "review",
        timeoutSeconds: 20,
        cwd: REPO,
        loadReviewer: reviewer.loadReviewer,
      }),
      (error: unknown) =>
        error instanceof OperationalError &&
        error.reason === "agent_cli_failed" &&
        /repair attempt was skipped/.test(error.message) &&
        /Raw output:\nnot json/.test(error.message),
    )
    assert.equal(reviewer.trace.prompts.length, 1)
  })

  test("preserves the parse failure when the repair attempt times out", async () => {
    const reviewer = fakeReviewer((_prompt, call) =>
      call === 1 ? { summary: "not json" } : { status: "timeout" },
    )

    await assert.rejects(
      requestReview({
        agent: "pi",
        prompt: "review",
        timeoutSeconds: 60,
        cwd: REPO,
        loadReviewer: reviewer.loadReviewer,
      }),
      (error: unknown) =>
        error instanceof OperationalError &&
        error.reason === "agent_cli_failed" &&
        /repair attempt did not complete/.test(error.message) &&
        /Raw output:\nnot json/.test(error.message),
    )
  })

  test("reports the configured budget when the reviewer times out", async () => {
    const reviewer = fakeReviewer(() => ({ status: "timeout" }))

    await assert.rejects(
      requestReview({
        agent: "codex",
        prompt: "review",
        timeoutSeconds: 30,
        cwd: REPO,
        loadReviewer: reviewer.loadReviewer,
      }),
      /exceeded the configured timeout of 30 seconds/,
    )
    assert.equal(reviewer.trace.closed, 1)
  })

  test("classifies runtime dependency installation failures", async () => {
    const cases = [
      ["npm error network request failed", "dependency_unavailable"],
      [
        "EPERM: operation not permitted, mkdir '/Users/reviewer/.cache/agent-review'",
        "sandbox_restriction",
      ],
    ] as const
    for (const [message, reason] of cases) {
      await assert.rejects(
        requestReview({
          agent: "claude",
          prompt: "review",
          timeoutSeconds: 30,
          cwd: REPO,
          loadReviewer: async () => {
            throw new Error(message)
          },
        }),
        (error: unknown) =>
          error instanceof OperationalError && error.reason === reason,
      )
    }
  })

  test("classifies failed turns by agentex error code", () => {
    assert.equal(
      classifyTurnResult(
        turnResult({
          status: "failed",
          errorCode: "auth_required",
          errorMessage: "Claude requires authentication.",
        }),
      ).reason,
      "auth_unavailable",
    )
    assert.equal(
      classifyTurnResult(
        turnResult({ status: "failed", errorMessage: "model unavailable" }),
      ).reason,
      "agent_cli_failed",
    )
  })

  test("classifies reviewer failure messages", () => {
    assert.equal(
      classifyFailure(
        "No conversation found with session ID: 00000000-0000-4000-8000-000000000000",
      ).reason,
      "session_lost",
    )
    assert.equal(
      classifyFailure(
        'Could not find "pi" binary. Searched common install paths and PATH.',
      ).reason,
      "agent_cli_unavailable",
    )
    assert.equal(
      classifyFailure("Not logged in. Please run /login").reason,
      "auth_unavailable",
    )
    assert.equal(
      classifyFailure("getaddrinfo ENOTFOUND api.openai.com").reason,
      "dependency_unavailable",
    )
    assert.equal(
      classifyFailure("EACCES: permission denied, open '/Users/r/.pi/sessions'")
        .reason,
      "sandbox_restriction",
    )
    assert.equal(
      classifyFailure("model unavailable").reason,
      "agent_cli_failed",
    )
  })
})
