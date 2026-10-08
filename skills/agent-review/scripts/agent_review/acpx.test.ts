import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
  type CommandResult,
  classifyFailure,
  REVIEWER_COMMANDS,
  type RunAcpx,
  requestReview,
} from "./acpx.ts"
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

describe("acpx orchestration", () => {
  test("creates a named session and returns its name", async () => {
    const calls: Array<{ args: string[]; input?: string }> = []
    const runAcpx: RunAcpx = async (args, input): Promise<CommandResult> => {
      calls.push({ args, input })
      if (args.includes("sessions"))
        return { stdout: "record-id\n", stderr: "" }
      return { stdout: JSON.stringify(validPayload()), stderr: "" }
    }

    const review = await requestReview({
      agent: "claude",
      prompt: "review prompt",
      timeoutSeconds: 30,
      cwd: "/tmp/project with space",
      runAcpx,
      createSessionName: () => "agent-review-fixed",
    })

    assert.equal(review.session_id, "agent-review-fixed")
    const createCall = calls[0]
    const promptCall = calls[1]
    assert.ok(createCall)
    assert.ok(promptCall)
    assert.deepEqual(createCall.args.slice(-6), [
      "--agent",
      REVIEWER_COMMANDS.claude,
      "sessions",
      "new",
      "--name",
      "agent-review-fixed",
    ])
    assert.equal(promptCall.input, "review prompt")
    assert.ok(promptCall.args.includes("--approve-all"))
    assert.ok(!promptCall.args.includes("--approve-reads"))
    assert.ok(!promptCall.args.includes("--non-interactive-permissions"))
    assert.deepEqual(promptCall.args.slice(-5), [
      "prompt",
      "-s",
      "agent-review-fixed",
      "-f",
      "-",
    ])
  })

  test("passes an explicit model during session creation and prompting", async () => {
    const calls: string[][] = []
    const runAcpx: RunAcpx = async (args) => {
      calls.push(args)
      return args.includes("sessions")
        ? { stdout: "record\n", stderr: "" }
        : { stdout: JSON.stringify(validPayload()), stderr: "" }
    }

    await requestReview({
      agent: "claude",
      prompt: "review prompt",
      timeoutSeconds: 30,
      model: "sonnet",
      cwd: "/repo",
      runAcpx,
      createSessionName: () => "named",
    })

    for (const args of calls) {
      assert.deepEqual(
        args.slice(args.indexOf("--model"), args.indexOf("--model") + 2),
        ["--model", "sonnet"],
      )
    }
  })

  test("resumes without creating another session", async () => {
    const calls: string[][] = []
    const runAcpx: RunAcpx = async (args) => {
      calls.push(args)
      return { stdout: JSON.stringify(validPayload()), stderr: "" }
    }
    const review = await requestReview({
      agent: "codex",
      prompt: "follow-up",
      timeoutSeconds: 30,
      resumeSessionId: "existing",
      cwd: "/repo",
      runAcpx,
    })
    assert.equal(review.session_id, "existing")
    assert.equal(calls.length, 1)
    const [call] = calls
    assert.ok(call)
    assert.ok(call.includes("existing"))
  })

  test("closes a newly created session after a failed review", async () => {
    const calls: Array<{ args: string[]; timeoutMs: number }> = []
    const failure = new OperationalError("agent_cli_failed", "review failed")
    const runAcpx: RunAcpx = async (args, _input, timeoutMs) => {
      calls.push({ args, timeoutMs })
      if (args.includes("new")) return { stdout: "record", stderr: "" }
      if (args.includes("close")) return { stdout: "closed", stderr: "" }
      throw failure
    }

    await assert.rejects(
      requestReview({
        agent: "pi",
        prompt: "review",
        timeoutSeconds: 30,
        cwd: "/repo",
        runAcpx,
        createSessionName: () => "named",
      }),
      (error: unknown) => error === failure,
    )

    const closeCall = calls.find(({ args }) => args.includes("close"))
    assert.ok(closeCall)
    assert.deepEqual(closeCall.args.slice(-5), [
      "--agent",
      REVIEWER_COMMANDS.pi,
      "sessions",
      "close",
      "named",
    ])
    assert.equal(closeCall.timeoutMs, 5_000)
  })

  test("does not close a resumed session after a failed review", async () => {
    const calls: string[][] = []
    const runAcpx: RunAcpx = async (args) => {
      calls.push(args)
      throw new OperationalError("agent_cli_failed", "review failed")
    }

    await assert.rejects(
      requestReview({
        agent: "pi",
        prompt: "follow-up",
        timeoutSeconds: 30,
        resumeSessionId: "existing",
        cwd: "/repo",
        runAcpx,
      }),
      /review failed/,
    )

    assert.equal(
      calls.some((args) => args.includes("close")),
      false,
    )
  })

  test("preserves the review failure when session cleanup fails", async () => {
    const failure = new OperationalError("agent_cli_failed", "review failed")
    const runAcpx: RunAcpx = async (args) => {
      if (args.includes("new")) return { stdout: "record", stderr: "" }
      if (args.includes("close")) throw new Error("cleanup failed")
      throw failure
    }

    await assert.rejects(
      requestReview({
        agent: "pi",
        prompt: "review",
        timeoutSeconds: 30,
        cwd: "/repo",
        runAcpx,
        createSessionName: () => "named",
      }),
      (error: unknown) => error === failure,
    )
  })

  test("discovers and sets the semantic reasoning option", async () => {
    const calls: string[][] = []
    const runAcpx: RunAcpx = async (args) => {
      calls.push(args)
      if (args.includes("show")) {
        return {
          stdout: JSON.stringify({
            acpx: {
              config_options: [
                {
                  id: "effort",
                  category: "thought_level",
                  options: [{ value: "low" }, { value: "high" }],
                },
              ],
            },
          }),
          stderr: "",
        }
      }
      if (args.includes("set")) return { stdout: "high\n", stderr: "" }
      if (args.includes("sessions")) return { stdout: "record\n", stderr: "" }
      return { stdout: JSON.stringify(validPayload()), stderr: "" }
    }

    await requestReview({
      agent: "claude",
      prompt: "review",
      timeoutSeconds: 30,
      reasoning: "high",
      cwd: "/repo",
      runAcpx,
      createSessionName: () => "named",
    })
    const setCall = calls.find((args) => args.includes("set"))
    assert.ok(setCall)
    assert.deepEqual(setCall.slice(-5), [
      "set",
      "effort",
      "high",
      "-s",
      "named",
    ])
  })

  test("rejects an unsupported reasoning value before prompting", async () => {
    const runAcpx: RunAcpx = async (args) => {
      if (args.includes("show")) {
        return {
          stdout: JSON.stringify({
            acpx: {
              config_options: [
                {
                  id: "effort",
                  category: "thought_level",
                  options: [{ value: "low" }],
                },
              ],
            },
          }),
          stderr: "",
        }
      }
      return { stdout: "record", stderr: "" }
    }
    await assert.rejects(
      requestReview({
        agent: "claude",
        prompt: "review",
        timeoutSeconds: 30,
        reasoning: "max",
        cwd: "/repo",
        runAcpx,
        createSessionName: () => "named",
      }),
      /Available values: low/,
    )
  })

  test("rejects reasoning when the reviewer exposes no thought level", async () => {
    const runAcpx: RunAcpx = async (args) => {
      if (args.includes("show")) {
        return {
          stdout: JSON.stringify({
            acpx: {
              config_options: [{ id: "mode", category: "mode" }],
            },
          }),
          stderr: "",
        }
      }
      return { stdout: "record", stderr: "" }
    }

    await assert.rejects(
      requestReview({
        agent: "claude",
        prompt: "review",
        timeoutSeconds: 30,
        reasoning: "high",
        cwd: "/repo",
        runAcpx,
        createSessionName: () => "named",
      }),
      (error: unknown) =>
        error instanceof OperationalError &&
        error.reason === "invalid_input" &&
        /not supported/.test(error.message),
    )
  })

  test("rejects malformed reasoning metadata before prompting", async () => {
    let promptCalled = false
    const runAcpx: RunAcpx = async (args) => {
      if (args.includes("show")) return { stdout: "not json", stderr: "" }
      if (args.includes("prompt")) promptCalled = true
      return { stdout: "record", stderr: "" }
    }

    await assert.rejects(
      requestReview({
        agent: "claude",
        prompt: "review",
        timeoutSeconds: 30,
        reasoning: "high",
        cwd: "/repo",
        runAcpx,
        createSessionName: () => "named",
      }),
      SyntaxError,
    )
    assert.equal(promptCalled, false)
  })

  test("uses the same session for one JSON-repair retry", async () => {
    const prompts: string[] = []
    const runAcpx: RunAcpx = async (args, input) => {
      if (args.includes("sessions")) return { stdout: "record", stderr: "" }
      prompts.push(input ?? "")
      return prompts.length === 1
        ? { stdout: "not json", stderr: "" }
        : { stdout: JSON.stringify(validPayload()), stderr: "" }
    }
    const review = await requestReview({
      agent: "pi",
      prompt: "review",
      timeoutSeconds: 60,
      cwd: "/repo",
      runAcpx,
      createSessionName: () => "named",
    })
    assert.equal(review.verdict, "approve")
    assert.equal(prompts.length, 2)
    const repairPrompt = prompts[1]
    assert.ok(repairPrompt)
    assert.match(repairPrompt, /previous response did not match/)
  })

  test("reports malformed output when too little repair budget remains", async () => {
    let promptCalls = 0
    const runAcpx: RunAcpx = async (args) => {
      if (args.includes("sessions")) return { stdout: "record", stderr: "" }
      if (args.includes("cancel")) return { stdout: "cancelled", stderr: "" }
      promptCalls += 1
      return { stdout: "not json", stderr: "" }
    }

    await assert.rejects(
      requestReview({
        agent: "pi",
        prompt: "review",
        timeoutSeconds: 29,
        cwd: "/repo",
        runAcpx,
        createSessionName: () => "named",
      }),
      (error: unknown) =>
        error instanceof OperationalError &&
        error.reason === "agent_cli_failed" &&
        /repair attempt was skipped/.test(error.message) &&
        /Raw output:\nnot json/.test(error.message),
    )
    assert.equal(promptCalls, 1)
  })

  test("preserves the parse failure when the repair attempt times out", async () => {
    let promptCalls = 0
    let cancelCalls = 0
    const runAcpx: RunAcpx = async (args) => {
      if (args.includes("sessions")) return { stdout: "record", stderr: "" }
      if (args.includes("cancel")) {
        cancelCalls += 1
        return { stdout: "cancelled", stderr: "" }
      }
      promptCalls += 1
      if (promptCalls === 1) return { stdout: "not json", stderr: "" }
      throw new OperationalError("timeout", "repair expired")
    }

    await assert.rejects(
      requestReview({
        agent: "pi",
        prompt: "review",
        timeoutSeconds: 60,
        cwd: "/repo",
        runAcpx,
        createSessionName: () => "named",
      }),
      (error: unknown) =>
        error instanceof OperationalError &&
        error.reason === "agent_cli_failed" &&
        /repair attempt did not complete/.test(error.message) &&
        /Raw output:\nnot json/.test(error.message),
    )
    assert.equal(promptCalls, 2)
    assert.equal(cancelCalls, 1)
  })

  test("preserves an acpx timeout while cooperatively cancelling the session", async () => {
    const calls: Array<{ args: string[]; timeoutMs: number }> = []
    const runAcpx: RunAcpx = async (args, _input, timeoutMs) => {
      calls.push({ args, timeoutMs })
      if (args.includes("sessions")) return { stdout: "record", stderr: "" }
      if (args.includes("cancel"))
        return { stdout: "cancel requested\n", stderr: "" }
      throw new OperationalError("timeout", "acpx internal timeout")
    }

    await assert.rejects(
      requestReview({
        agent: "pi",
        prompt: "review",
        timeoutSeconds: 30,
        cwd: "/repo",
        runAcpx,
        createSessionName: () => "named",
      }),
      /acpx internal timeout/,
    )

    const cancelCall = calls.find(({ args }) => args.includes("cancel"))
    const closeCall = calls.find(({ args }) => args.includes("close"))
    assert.ok(cancelCall)
    assert.ok(closeCall)
    assert.deepEqual(cancelCall.args.slice(-5), [
      "--agent",
      REVIEWER_COMMANDS.pi,
      "cancel",
      "-s",
      "named",
    ])
    assert.equal(cancelCall.timeoutMs, 5_000)
    assert.ok(calls.indexOf(cancelCall) < calls.indexOf(closeCall))
  })

  test("reports the configured budget only when the review deadline expires", async () => {
    const calls: string[][] = []
    const runAcpx: RunAcpx = async (args) => {
      calls.push(args)
      return { stdout: "nothing to cancel\n", stderr: "" }
    }

    await assert.rejects(
      requestReview({
        agent: "pi",
        prompt: "review",
        timeoutSeconds: 0,
        cwd: "/repo",
        runAcpx,
        createSessionName: () => "named",
      }),
      /exceeded the configured timeout of 0 seconds/,
    )

    assert.equal(calls.length, 1)
    const [call] = calls
    assert.ok(call)
    assert.ok(call.includes("cancel"))
  })

  test("classifies ACP, dependency, and state failures", () => {
    assert.equal(
      classifyFailure("RUNTIME AUTH_REQUIRED agent advertised auth methods")
        .reason,
      "auth_unavailable",
    )
    assert.equal(
      classifyFailure("npm ENOTFOUND registry.npmjs.org").reason,
      "dependency_unavailable",
    )
    assert.equal(
      classifyFailure(
        "EPERM: operation not permitted, mkdir '/Users/reviewer/.acpx'",
      ).reason,
      "sandbox_restriction",
    )
    assert.equal(
      classifyFailure("EACCES: permission denied, mkdir '/Users/reviewer/.npm'")
        .reason,
      "sandbox_restriction",
    )
    assert.equal(
      classifyFailure('[acpx] error: {"code":"TIMEOUT"}', 3).reason,
      "timeout",
    )
    assert.equal(
      classifyFailure("error: unknown option '-s'\n--timeout <seconds>", 2)
        .reason,
      "agent_cli_failed",
    )
    assert.equal(
      classifyFailure("model unavailable").reason,
      "agent_cli_failed",
    )
  })

  test("includes the terminating signal when no exit code is available", () => {
    const failure = classifyFailure("unknown error", null, "SIGKILL")

    assert.equal(failure.reason, "agent_cli_failed")
    assert.match(failure.message, /terminated by signal SIGKILL/)
  })
})
