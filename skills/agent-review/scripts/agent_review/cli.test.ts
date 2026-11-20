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
    approval_reason: "looks good",
    verification: "read the diff",
    process_feedback: [],
  }
}

const TREE_A = "a".repeat(40)
const TREE_B = "b".repeat(40)

function createPromptRecordingReviewer(prompts: string[]): LoadReviewer {
  return async () => async () => ({
    sessionId: "review-1",
    send: async (prompt) => {
      prompts.push(prompt)
      return {
        summary: JSON.stringify(validPayload()),
        costUsd: null,
        status: "completed",
        errorCode: null,
        errorMessage: null,
      }
    },
    close: async () => {},
  })
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
        "--input-file",
        "round.md",
        "--resume-session-id",
        "review-1",
        "--model",
        "sonnet",
      ]),
      {
        agent: "claude",
        inputFile: "round.md",
        followUp: undefined,
        model: "sonnet",
        reasoning: undefined,
        resumeSessionId: "review-1",
        sinceSnapshot: undefined,
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

  test("requires an input file", () => {
    assert.throws(
      () => parseArgs(["--agent", "claude"]),
      /--input-file is required/,
    )
  })

  test("rejects --follow-up for CLI reviewers", () => {
    assert.throws(
      () =>
        validateArgs({ agent: "codex", inputFile: "round.md", followUp: true }),
      /--resume-session-id/,
    )
  })

  test("rejects an empty session id", () => {
    assert.throws(
      () =>
        validateArgs({
          agent: "codex",
          inputFile: "round.md",
          resumeSessionId: " ",
        }),
      /must not be empty/,
    )
  })

  test("rejects a snapshot without a resumed CLI session", () => {
    assert.throws(
      () =>
        validateArgs({
          agent: "codex",
          inputFile: "round.md",
          sinceSnapshot: TREE_A,
        }),
      /requires --resume-session-id/,
    )
  })

  test("rejects a malformed snapshot", () => {
    assert.throws(
      () =>
        validateArgs({
          agent: "codex",
          inputFile: "round.md",
          resumeSessionId: "review-1",
          sinceSnapshot: "--output=x",
        }),
      /snapshot value from the previous round/,
    )
  })

  test("rejects CLI-only options for user relay", () => {
    assert.throws(
      () =>
        validateArgs({ agent: "manual", inputFile: "round.md", model: "x" }),
      /--model cannot be used/,
    )
    assert.throws(
      () =>
        validateArgs({
          agent: "manual",
          inputFile: "round.md",
          sinceSnapshot: TREE_A,
        }),
      /--since-snapshot cannot be used/,
    )
  })

  test("rejects timeout values that overflow Node timers", () => {
    assert.doesNotThrow(() =>
      validateArgs({
        agent: "pi",
        inputFile: "round.md",
        timeoutSeconds: MAX_TIMEOUT_SECONDS,
      }),
    )
    assert.throws(
      () =>
        validateArgs({
          agent: "pi",
          inputFile: "round.md",
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
      argv: ["--agent", "manual", "--input-file", "round.md"],
      readInputFile: async () => "Review src/auth.ts",
      randomToken: () => "a1b2c3d4",
      writeStdout: capture.write,
      loadReviewer: async () => {
        throw new Error("manual must not invoke a reviewer")
      },
    })
    assert.equal(exitCode, 0)
    assert.match(capture.output(), /<review_method>\n# Review method\n/)
    assert.match(capture.output(), /Review src\/auth.ts/)
    assert.match(capture.output(), /"a1b2c3d4"/)
  })

  test("emits a delta prompt for a marked follow-up", async () => {
    const capture = captureOutput()
    const exitCode = await main({
      argv: ["--agent", "manual", "--input-file", "round.md", "--follow-up"],
      readInputFile: async () => `${HOST_RESPONSE_MARKER}\nAccepted: fixed it.`,
      randomToken: () => "e5f6a7b8",
      writeStdout: capture.write,
    })
    assert.equal(exitCode, 0)
    assert.match(capture.output(), /^In this round, verify the host's changes/)
    assert.match(capture.output(), /\nHost agent response/)
    assert.doesNotMatch(capture.output(), /Review input:/)
  })

  test("rejects a follow-up without the response marker", async () => {
    const capture = captureOutput()
    const exitCode = await main({
      argv: ["--agent", "manual", "--input-file", "round.md", "--follow-up"],
      readInputFile: async () => "Accepted: fixed it.",
      writeStdout: capture.write,
    })
    assert.equal(exitCode, 1)
    assert.match(
      capture.output(),
      /requires an '=== AGENT_REVIEW_RESPONSE ===' line/,
    )
  })

  test("rejects the response marker without a follow-up signal", async () => {
    for (const input of [
      `${HOST_RESPONSE_MARKER}\nAccepted: fixed it.`,
      `Review X\n${HOST_RESPONSE_MARKER}\n  \n`,
    ]) {
      const capture = captureOutput()
      const exitCode = await main({
        argv: ["--agent", "codex", "--input-file", "round.md"],
        readInputFile: async () => input,
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
      argv: ["--agent", "codex", "--input-file", "round.md"],
      readInputFile: async () => "Review src/auth.ts",
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
      argv: [
        "--agent",
        "codex",
        "--input-file",
        "round.md",
        "--resume-session-id",
        "review-1",
      ],
      readInputFile: async () => `${HOST_RESPONSE_MARKER}\nAccepted: fixed it.`,
      cwd: "/repo",
      writeStdout: capture.write,
      loadReviewer,
    })
    assert.equal(exitCode, 0)
    assert.equal(resumedSessionId, "review-1")
    assert.match(sentPrompt, /^In this round, verify the host's changes/)
    assert.match(sentPrompt, /\nHost agent response/)
    assert.doesNotMatch(sentPrompt, /host agent's work/)
  })

  test("returns the working-tree snapshot with a CLI review", async () => {
    const capture = captureOutput()
    const exitCode = await main({
      argv: ["--agent", "codex", "--input-file", "round.md"],
      readInputFile: async () => "Review src/auth.ts",
      cwd: "/repo",
      writeStdout: capture.write,
      loadReviewer: createPromptRecordingReviewer([]),
      takeRoundSnapshot: async () => ({ snapshot: TREE_A }),
    })
    assert.equal(exitCode, 0)
    assert.equal(JSON.parse(capture.output()).snapshot, TREE_A)
  })

  test("points a resumed review at the changes since the given snapshot", async () => {
    const capture = captureOutput()
    const prompts: string[] = []
    let since: string | undefined
    const exitCode = await main({
      argv: [
        "--agent",
        "codex",
        "--input-file",
        "round.md",
        "--resume-session-id",
        "review-1",
        "--since-snapshot",
        TREE_A,
      ],
      readInputFile: async () => `${HOST_RESPONSE_MARKER}\nAccepted: fixed it.`,
      cwd: "/repo",
      writeStdout: capture.write,
      loadReviewer: createPromptRecordingReviewer(prompts),
      takeRoundSnapshot: async (options) => {
        since = options.since
        return { snapshot: TREE_B, changes: { from: TREE_A, to: TREE_B } }
      },
    })
    assert.equal(exitCode, 0)
    assert.equal(since, TREE_A)
    assert.match(
      prompts[0] ?? "",
      new RegExp(`git diff --no-relative --name-status ${TREE_A} ${TREE_B}`),
    )
    assert.equal(JSON.parse(capture.output()).snapshot, TREE_B)
  })

  test("runs the review and reports a snapshot failure", async () => {
    const capture = captureOutput()
    const prompts: string[] = []
    const exitCode = await main({
      argv: [
        "--agent",
        "codex",
        "--input-file",
        "round.md",
        "--resume-session-id",
        "review-1",
        "--since-snapshot",
        TREE_A,
      ],
      readInputFile: async () => `${HOST_RESPONSE_MARKER}\nAccepted: fixed it.`,
      cwd: "/repo",
      writeStdout: capture.write,
      loadReviewer: createPromptRecordingReviewer(prompts),
      takeRoundSnapshot: async () => ({
        snapshot: TREE_B,
        error: "The previous snapshot is missing or is not a tree",
      }),
    })
    assert.equal(exitCode, 0)
    assert.match(prompts[0] ?? "", /since your previous round are unavailable/)
    const output = JSON.parse(capture.output())
    assert.equal(output.snapshot, TREE_B)
    assert.match(output.snapshot_error, /missing or is not a tree/)
  })

  test("rejects an unmarked CLI follow-up", async () => {
    const capture = captureOutput()
    const exitCode = await main({
      argv: [
        "--agent",
        "codex",
        "--input-file",
        "round.md",
        "--resume-session-id",
        "review-1",
      ],
      readInputFile: async () => "Accepted: fixed it.",
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

  test("rejects an unreadable input file", async () => {
    const capture = captureOutput()
    const exitCode = await main({
      argv: ["--agent", "manual", "--input-file", "/nonexistent/round.md"],
      writeStdout: capture.write,
    })
    assert.equal(exitCode, 1)
    assert.equal(JSON.parse(capture.output()).reason, "invalid_input")
  })

  test("emits operational errors as JSON", async () => {
    const capture = captureOutput()
    const exitCode = await main({
      argv: [
        "--agent",
        "manual",
        "--input-file",
        "round.md",
        "--reasoning",
        "high",
      ],
      readInputFile: async () => "Review X",
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
      argv: [
        "--agent",
        "codex",
        "--input-file",
        "round.md",
        "--timeout-seconds",
        "7",
      ],
      readInputFile: async () => "Review X",
      writeStdout: capture.write,
      loadReviewer,
      takeRoundSnapshot: async () => ({}),
    })
    assert.equal(exitCode, 1)
    assert.equal(JSON.parse(capture.output()).timeout_seconds, 7)
  })
})
