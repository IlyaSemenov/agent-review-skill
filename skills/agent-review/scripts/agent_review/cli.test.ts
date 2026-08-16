import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { ACPX_PACKAGE, type RunAcpx } from "./acpx.ts"
import { main, parseArgs, validateArgs } from "./cli.ts"
import { OperationalError } from "./core.ts"

function validPayload() {
  return {
    verdict: "approve",
    issues: [],
    open_questions: [],
    loop_signal: false,
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

  test("rejects reasoning for OpenCode", () => {
    assert.throws(
      () =>
        validateArgs({ agent: "opencode", iteration: 1, reasoning: "high" }),
      new RegExp(`not supported.*${ACPX_PACKAGE.replace(".", "\\.")}`),
    )
  })

  test("rejects CLI-only options for user relay", () => {
    assert.throws(
      () => validateArgs({ agent: "manual", iteration: 1, model: "x" }),
      /--model cannot be used/,
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
      runAcpx: async () => {
        throw new Error("manual must not invoke acpx")
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

  test("emits normalized Unicode JSON for a CLI review", async () => {
    const capture = captureOutput()
    const runAcpx: RunAcpx = async (args) => {
      if (args.includes("sessions")) return { stdout: "record", stderr: "" }
      return {
        stdout: JSON.stringify({
          ...validPayload(),
          approval_reason: "Всё хорошо",
        }),
        stderr: "",
      }
    }
    const exitCode = await main({
      argv: ["--agent", "codex", "--iteration", "1"],
      stdin: "Review src/auth.ts",
      cwd: "/repo",
      createSessionName: () => "named",
      writeStdout: capture.write,
      runAcpx,
    })
    assert.equal(exitCode, 0)
    assert.match(capture.output(), /Всё хорошо/)
    assert.doesNotMatch(capture.output(), /\\u0412/)
  })

  test("emits operational errors as JSON", async () => {
    const capture = captureOutput()
    const exitCode = await main({
      argv: ["--agent", "opencode", "--iteration", "1", "--reasoning", "high"],
      stdin: "Review X",
      writeStdout: capture.write,
    })
    assert.equal(exitCode, 1)
    assert.deepEqual(JSON.parse(capture.output()), {
      kind: "operational_error",
      reason: "invalid_input",
      message: `--reasoning is not supported for --agent opencode through ${ACPX_PACKAGE}.`,
    })
  })

  test("surfaces timeouts with the configured budget", async () => {
    const capture = captureOutput()
    const runAcpx: RunAcpx = async () => {
      throw new OperationalError("timeout", "expired")
    }
    const exitCode = await main({
      argv: ["--agent", "codex", "--iteration", "1", "--timeout-seconds", "7"],
      stdin: "Review X",
      writeStdout: capture.write,
      runAcpx,
    })
    assert.equal(exitCode, 1)
    assert.equal(JSON.parse(capture.output()).timeout_seconds, 7)
  })
})
