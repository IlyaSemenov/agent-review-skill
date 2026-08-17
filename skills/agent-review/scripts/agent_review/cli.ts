import { randomBytes } from "node:crypto"
import process from "node:process"
import { parseArgs as parseNodeArgs } from "node:util"

import {
  type AgentName,
  AVAILABLE_AGENTS,
  type RunAcpx,
  requestReview,
  validateAgentOptions,
} from "./acpx.ts"
import {
  buildPrompt,
  errorMessage,
  OperationalError,
  parseStdinPayload,
} from "./core.ts"

export const DEFAULT_TIMEOUT_SECONDS = 900
export const MAX_TIMEOUT_SECONDS = Math.floor(2_147_483_647 / 1_000)

const MANUAL_AGENT = "manual"

export type CliArgs = {
  agent: AgentName | typeof MANUAL_AGENT
  model?: string
  reasoning?: string
  iteration: number
  maxIterations?: number
  resumeSessionId?: string
  timeoutSeconds?: number
}

export function parseArgs(argv: string[]): CliArgs | { help: true } {
  if (
    argv.some(
      (argument) =>
        argument === "--add-dir" || argument.startsWith("--add-dir="),
    )
  ) {
    throw new OperationalError(
      "invalid_input",
      "--add-dir is not supported by the acpx CLI transport; keep review material under the review working directory.",
    )
  }

  let values: Record<string, string | boolean | undefined>
  try {
    ;({ values } = parseNodeArgs({
      args: argv,
      allowPositionals: false,
      strict: true,
      options: {
        agent: { type: "string" },
        model: { type: "string" },
        reasoning: { type: "string" },
        iteration: { type: "string" },
        "max-iterations": { type: "string" },
        "resume-session-id": { type: "string" },
        "timeout-seconds": { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    }))
  } catch (error) {
    throw new OperationalError("invalid_input", errorMessage(error))
  }
  if (values.help === true) return { help: true }

  const agentValue = stringValue(values.agent)
  if (!agentValue)
    throw new OperationalError("invalid_input", "--agent is required")
  if (
    agentValue !== MANUAL_AGENT &&
    !AVAILABLE_AGENTS.includes(agentValue as AgentName)
  ) {
    throw new OperationalError(
      "invalid_input",
      `Unknown agent '${agentValue}'. Available agents: ${AVAILABLE_AGENTS.join(", ")}, or manual.`,
    )
  }

  const iteration = parseIntegerOption(
    stringValue(values.iteration),
    "--iteration",
    true,
  )
  if (iteration === undefined)
    throw new OperationalError("invalid_input", "--iteration is required")
  return {
    agent: agentValue as CliArgs["agent"],
    model: stringValue(values.model),
    reasoning: stringValue(values.reasoning),
    iteration,
    maxIterations: parseIntegerOption(
      stringValue(values["max-iterations"]),
      "--max-iterations",
    ),
    resumeSessionId: stringValue(values["resume-session-id"]),
    timeoutSeconds: parseIntegerOption(
      stringValue(values["timeout-seconds"]),
      "--timeout-seconds",
    ),
  }
}

export function validateArgs(args: CliArgs): void {
  const manual = args.agent === MANUAL_AGENT
  if (args.iteration < 1) {
    throw new OperationalError(
      "invalid_input",
      "--iteration must be at least 1",
    )
  }
  if (args.maxIterations !== undefined && args.maxIterations < 1) {
    throw new OperationalError(
      "invalid_input",
      "--max-iterations must be at least 1",
    )
  }
  if (args.maxIterations !== undefined && args.iteration > args.maxIterations) {
    throw new OperationalError(
      "invalid_input",
      "--iteration cannot exceed --max-iterations",
    )
  }
  if (!manual && args.timeoutSeconds !== undefined && args.timeoutSeconds < 1) {
    throw new OperationalError(
      "invalid_input",
      "--timeout-seconds must be at least 1",
    )
  }
  if (
    !manual &&
    args.timeoutSeconds !== undefined &&
    args.timeoutSeconds > MAX_TIMEOUT_SECONDS
  ) {
    throw new OperationalError(
      "invalid_input",
      `--timeout-seconds must be at most ${MAX_TIMEOUT_SECONDS}`,
    )
  }
  if (args.iteration > 1 && !manual && !args.resumeSessionId) {
    throw new OperationalError(
      "invalid_input",
      "iteration > 1 requires --resume-session-id",
    )
  }
  if (args.agent === MANUAL_AGENT) {
    const forbidden = [
      ["--resume-session-id", args.resumeSessionId],
      ["--model", args.model],
      ["--reasoning", args.reasoning],
      ["--timeout-seconds", args.timeoutSeconds],
    ] as const
    const used = forbidden.find(([, value]) => value !== undefined)
    if (used) {
      throw new OperationalError(
        "invalid_input",
        `${used[0]} cannot be used with --agent manual`,
      )
    }
  } else {
    validateAgentOptions(args.agent, { reasoning: args.reasoning })
  }
}

export async function main(
  dependencies: {
    argv?: string[]
    stdin?: string
    cwd?: string
    runAcpx?: RunAcpx
    randomToken?: () => string
    createSessionName?: () => string
    writeStdout?: (text: string) => void
  } = {},
): Promise<number> {
  const writeStdout =
    dependencies.writeStdout ?? ((text: string) => process.stdout.write(text))
  let args: CliArgs
  try {
    const parsed = parseArgs(dependencies.argv ?? process.argv.slice(2))
    if ("help" in parsed) {
      writeStdout(`${usage()}\n`)
      return 0
    }
    args = parsed
    validateArgs(args)
  } catch (error) {
    return emitError(writeStdout, asOperationalError(error))
  }

  const rawInput = dependencies.stdin ?? (await readStdin())
  let reviewInput: string | undefined
  let hostResponse: string | undefined
  try {
    ;[reviewInput, hostResponse] = parseStdinPayload(rawInput)
  } catch (error) {
    return emitError(
      writeStdout,
      new OperationalError("invalid_input", errorMessage(error)),
    )
  }

  if (args.iteration === 1 && hostResponse !== undefined) {
    return emitError(
      writeStdout,
      new OperationalError(
        "invalid_input",
        "iteration 1 accepts only review input, not a response bundle.",
      ),
    )
  }
  if (args.iteration > 1 && hostResponse === undefined) {
    hostResponse = reviewInput
    reviewInput = undefined
  }

  const manual = args.agent === MANUAL_AGENT
  const prompt = buildPrompt({
    iteration: args.iteration,
    reviewInput,
    hostResponse,
    manualRoundToken: manual
      ? (dependencies.randomToken ?? (() => randomBytes(4).toString("hex")))()
      : undefined,
  })
  if (args.agent === MANUAL_AGENT) {
    writeStdout(prompt)
    return 0
  }

  const timeoutSeconds = args.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS
  try {
    const review = await requestReview({
      agent: args.agent,
      prompt,
      timeoutSeconds,
      resumeSessionId: args.resumeSessionId,
      model: args.model,
      reasoning: args.reasoning,
      cwd: dependencies.cwd ?? process.cwd(),
      runAcpx: dependencies.runAcpx,
      createSessionName: dependencies.createSessionName,
    })
    writeStdout(`${JSON.stringify(review, undefined, 2)}\n`)
    return 0
  } catch (error) {
    const operational = asOperationalError(error)
    return emitError(
      writeStdout,
      operational,
      operational.reason === "timeout" ? timeoutSeconds : undefined,
    )
  }
}

function parseIntegerOption(
  value: string | undefined,
  option: string,
  required = false,
): number | undefined {
  if (value === undefined) {
    if (required)
      throw new OperationalError("invalid_input", `${option} is required`)
    return undefined
  }
  if (!/^-?\d+$/.test(value)) {
    throw new OperationalError("invalid_input", `${option} must be an integer`)
  }
  return Number(value)
}

function stringValue(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined
}

function asOperationalError(error: unknown): OperationalError {
  return error instanceof OperationalError
    ? error
    : new OperationalError("agent_cli_failed", errorMessage(error))
}

function emitError(
  writeStdout: (text: string) => void,
  error: OperationalError,
  timeoutSeconds?: number,
): number {
  const payload: Record<string, unknown> = {
    kind: "operational_error",
    reason: error.reason,
    message: error.message,
  }
  if (timeoutSeconds !== undefined) payload.timeout_seconds = timeoutSeconds
  writeStdout(`${JSON.stringify(payload, undefined, 2)}\n`)
  return 1
}

function usage(): string {
  return [
    "Usage: node agent_review.ts --agent <name|manual> --iteration <number> [options]",
    "",
    `CLI agents: ${AVAILABLE_AGENTS.join(", ")}`,
    "Options: --model, --reasoning, --max-iterations, --resume-session-id, --timeout-seconds",
  ].join("\n")
}

async function readStdin(): Promise<string> {
  let input = ""
  process.stdin.setEncoding("utf8")
  for await (const chunk of process.stdin) input += chunk
  return input
}
