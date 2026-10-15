import assert from "node:assert/strict"
import { describe, test } from "node:test"

import type { LoadReviewer } from "./agentex.ts"
import { MAX_TIMEOUT_SECONDS, main, parseArgs, validateArgs } from "./cli.ts"
import { OperationalError } from "./core.ts"

function validPayload() {
  return {
    verdict: "approve",
    issues: [],
    open_questions: [],
    loop_signal: false,
    deferred_polish: false,
    approval_reason: "looks good",
  }
}

function captureOutput(): {
  output: () => string
  write: (text: string) => void
} {
  let value = ""
  return {
    output: () => value,
    write: (text) => {
      value += text
    },
  }
}

describe("CLI argument contract", () => {
  test("parses supported options", () => {
    assert.deepEqual(
      parseArgs([
        "--agent",
        "claude",
        "--iteration=2",
        "--resume-session-id",
        "review-1",
        "--model",
        "sonnet",
      ]),
      {
        agent: "claude",
        iteration: 2,
        maxIterations: undefined,
        model: "sonnet",
        reasoning: undefined,
        resumeSessionId: "review-1",
        timeoutSeconds: undefined,
      },
    )
  })

  test("rejects removed add-dir", () => {
    assert.throws(
      () =>
        parseArgs([
          "--agent",
          "claude",
          "--iteration",
          "1",
          "--add-dir",
          "/tmp",
        ]),
      /not supported/,
    )
  })

  test("requires a session for CLI continuation", () => {
    assert.throws(
      () => validateArgs({ agent: "codex", iteration: 2 }),
      /requires --resume-session-id/,
    )
  })

  test("rejects CLI-only options for user relay", () => {
    assert.throws(
      () => validateArgs({ agent: "manual", iteration: 1, model: "x" }),
      /--model cannot be used/,
    )
  })

  test("rejects timeout values that overflow Node timers", () => {
    assert.doesNotThrow(() =>
      validateArgs({
        agent: "pi",
        iteration: 1,
        timeoutSeconds: MAX_TIMEOUT_SECONDS,
      }),
    )
    assert.throws(
      () =>
        validateArgs({
          agent: "pi",
          iteration: 1,
          timeoutSeconds: MAX_TIMEOUT_SECONDS + 1,
        }),
      new RegExp(`at most ${MAX_TIMEOUT_SECONDS}`),
    )
  })
})

describe("main", () => {
  test("emits an isolated user-relay prompt", async () => {
    const capture = captureOutput()
    const exitCode = await main({
      argv: ["--agent", "manual", "--iteration", "1"],
      stdin: "Review src/auth.ts",
      randomToken: () => "a1b2c3d4",
      writeStdout: capture.write,
      loadReviewer: async () => {
        throw new Error("manual must not invoke a reviewer")
      },
    })
    assert.equal(exitCode, 0)
    assert.match(capture.output(), /Review src\/auth.ts/)
    assert.match(capture.output(), /"a1b2c3d4"/)
  })

  test("treats unmarked later-round input as the host response", async () => {
    const capture = captureOutput()
    const exitCode = await main({
      argv: ["--agent", "manual", "--iteration", "2"],
      stdin: "Accepted: fixed it.",
      randomToken: () => "e5f6a7b8",
      writeStdout: capture.write,
    })
    assert.equal(exitCode, 0)
    assert.match(capture.output(), /^Host agent response/)
    assert.doesNotMatch(capture.output(), /Review input:/)
  })

  test("marks the round at --max-iterations as final", async () => {
    const capture = captureOutput()
    const exitCode = await main({
      argv: ["--agent", "manual", "--iteration", "2", "--max-iterations", "2"],
      stdin: "Accepted: fixed it.",
      randomToken: () => "e5f6a7b8",
      writeStdout: capture.write,
    })
    assert.equal(exitCode, 0)
    assert.match(capture.output(), /final review round/)
  })

  test("emits normalized Unicode JSON for a CLI review", async () => {
    const capture = captureOutput()
    const loadReviewer: LoadReviewer = async () => async () => ({
      sessionId: "native",
      send: async () => ({
        summary: JSON.stringify({
          ...validPayload(),
          approval_reason: "Всё хорошо",
        }),
        costUsd: null,
        status: "completed",
        errorCode: null,
        errorMessage: null,
      }),
      close: async () => {},
    })
    const exitCode = await main({
      argv: ["--agent", "codex", "--iteration", "1"],
      stdin: "Review src/auth.ts",
      cwd: "/repo",
      writeStdout: capture.write,
      loadReviewer,
    })
    assert.equal(exitCode, 0)
    assert.match(capture.output(), /Всё хорошо/)
    assert.doesNotMatch(capture.output(), /\\u0412/)
  })

  test("emits operational errors as JSON", async () => {
    const capture = captureOutput()
    const exitCode = await main({
      argv: ["--agent", "manual", "--iteration", "1", "--reasoning", "high"],
      stdin: "Review X",
      writeStdout: capture.write,
    })
    assert.equal(exitCode, 1)
    assert.deepEqual(JSON.parse(capture.output()), {
      kind: "operational_error",
      reason: "invalid_input",
      message: "--reasoning cannot be used with --agent manual",
    })
  })

  test("surfaces timeouts with the configured budget", async () => {
    const capture = captureOutput()
    const loadReviewer: LoadReviewer = async () => {
      throw new OperationalError("timeout", "expired")
    }
    const exitCode = await main({
      argv: ["--agent", "codex", "--iteration", "1", "--timeout-seconds", "7"],
      stdin: "Review X",
      writeStdout: capture.write,
      loadReviewer,
    })
    assert.equal(exitCode, 1)
    assert.equal(JSON.parse(capture.output()).timeout_seconds, 7)
  })
})
