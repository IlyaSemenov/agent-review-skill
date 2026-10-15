import assert from "node:assert/strict"
import { describe, test } from "node:test"

import type { LoadReviewer } from "./agentex.ts"
import { MAX_TIMEOUT_SECONDS, main, parseArgs, validateArgs } from "./cli.ts"
import { HOST_RESPONSE_MARKER, OperationalError } from "./core.ts"

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
        "--resume-session-id",
        "review-1",
        "--model",
        "sonnet",
      ]),
      {
        agent: "claude",
        followUp: undefined,
        model: "sonnet",
        reasoning: undefined,
        resumeSessionId: "review-1",
        timeoutSeconds: undefined,
      },
    )
  })

  test("rejects removed add-dir", () => {
    assert.throws(
      () => parseArgs(["--agent", "claude", "--add-dir", "/tmp"]),
      /not supported/,
    )
  })

  test("rejects --follow-up for CLI reviewers", () => {
    assert.throws(
      () => validateArgs({ agent: "codex", followUp: true }),
      /--resume-session-id/,
    )
  })

  test("rejects an empty session id", () => {
    assert.throws(
      () => validateArgs({ agent: "codex", resumeSessionId: " " }),
      /must not be empty/,
    )
  })

  test("rejects CLI-only options for user relay", () => {
    assert.throws(
      () => validateArgs({ agent: "manual", model: "x" }),
      /--model cannot be used/,
    )
  })

  test("rejects timeout values that overflow Node timers", () => {
    assert.doesNotThrow(() =>
      validateArgs({
        agent: "pi",
        timeoutSeconds: MAX_TIMEOUT_SECONDS,
      }),
    )
    assert.throws(
      () =>
        validateArgs({
          agent: "pi",
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
      argv: ["--agent", "manual"],
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

  test("emits a delta prompt for a marked follow-up", async () => {
    const capture = captureOutput()
    const exitCode = await main({
      argv: ["--agent", "manual", "--follow-up"],
      stdin: `${HOST_RESPONSE_MARKER}\nAccepted: fixed it.`,
      randomToken: () => "e5f6a7b8",
      writeStdout: capture.write,
    })
    assert.equal(exitCode, 0)
    assert.match(capture.output(), /^Host agent response/)
    assert.doesNotMatch(capture.output(), /Review input:/)
  })

  test("rejects a follow-up without the response marker", async () => {
    const capture = captureOutput()
    const exitCode = await main({
      argv: ["--agent", "manual", "--follow-up"],
      stdin: "Accepted: fixed it.",
      writeStdout: capture.write,
    })
    assert.equal(exitCode, 1)
    assert.match(
      capture.output(),
      /requires an '=== AGENT_REVIEW_RESPONSE ===' line/,
    )
  })

  test("rejects the response marker without a follow-up signal", async () => {
    for (const stdin of [
      `${HOST_RESPONSE_MARKER}\nAccepted: fixed it.`,
      `Review X\n${HOST_RESPONSE_MARKER}\n  \n`,
    ]) {
      const capture = captureOutput()
      const exitCode = await main({
        argv: ["--agent", "codex"],
        stdin,
        writeStdout: capture.write,
        loadReviewer: async () => {
          throw new Error("a rejected round must not invoke a reviewer")
        },
      })
      assert.equal(exitCode, 1)
      assert.match(capture.output(), /requires a follow-up round/)
    }
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
      argv: ["--agent", "codex"],
      stdin: "Review src/auth.ts",
      cwd: "/repo",
      writeStdout: capture.write,
      loadReviewer,
    })
    assert.equal(exitCode, 0)
    assert.match(capture.output(), /Всё хорошо/)
    assert.doesNotMatch(capture.output(), /\\u0412/)
  })

  test("resumes a CLI review with a delta prompt", async () => {
    const capture = captureOutput()
    let resumedSessionId: string | undefined
    let sentPrompt = ""
    const loadReviewer: LoadReviewer = async () => async (options) => {
      resumedSessionId = options.sessionId
      return {
        sessionId: "review-1",
        send: async (prompt) => {
          sentPrompt = prompt
          return {
            summary: JSON.stringify(validPayload()),
            costUsd: null,
            status: "completed",
            errorCode: null,
            errorMessage: null,
          }
        },
        close: async () => {},
      }
    }
    const exitCode = await main({
      argv: ["--agent", "codex", "--resume-session-id", "review-1"],
      stdin: `${HOST_RESPONSE_MARKER}\nAccepted: fixed it.`,
      cwd: "/repo",
      writeStdout: capture.write,
      loadReviewer,
    })
    assert.equal(exitCode, 0)
    assert.equal(resumedSessionId, "review-1")
    assert.match(sentPrompt, /^Host agent response/)
    assert.doesNotMatch(sentPrompt, /host agent's work/)
  })

  test("rejects an unmarked CLI follow-up", async () => {
    const capture = captureOutput()
    const exitCode = await main({
      argv: ["--agent", "codex", "--resume-session-id", "review-1"],
      stdin: "Accepted: fixed it.",
      writeStdout: capture.write,
      loadReviewer: async () => {
        throw new Error("a rejected round must not invoke a reviewer")
      },
    })
    assert.equal(exitCode, 1)
    assert.match(
      capture.output(),
      /requires an '=== AGENT_REVIEW_RESPONSE ===' line/,
    )
  })

  test("emits operational errors as JSON", async () => {
    const capture = captureOutput()
    const exitCode = await main({
      argv: ["--agent", "manual", "--reasoning", "high"],
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
      argv: ["--agent", "codex", "--timeout-seconds", "7"],
      stdin: "Review X",
      writeStdout: capture.write,
      loadReviewer,
    })
    assert.equal(exitCode, 1)
    assert.equal(JSON.parse(capture.output()).timeout_seconds, 7)
  })
})
