import { randomBytes } from "node:crypto"
import { readFile } from "node:fs/promises"
import process from "node:process"
import { fileURLToPath } from "node:url"
import { parseArgs as parseNodeArgs } from "node:util"

import {
  type AgentName,
  AVAILABLE_AGENTS,
  type LoadReviewer,
  requestReview,
} from "./agentex.ts"
import {
  buildPrompt,
  errorMessage,
  HOST_RESPONSE_MARKER,
  OperationalError,
  parseRoundInput,
  type RoundInput,
} from "./core.ts"

const DEFAULT_TIMEOUT_SECONDS = 900
export const MAX_TIMEOUT_SECONDS = Math.floor(2_147_483_647 / 1_000)

const MANUAL_AGENT = "manual"
const REVIEW_METHOD_PATH = fileURLToPath(
  new URL("../../review-method.md", import.meta.url),
)

export type CliArgs = {
  agent: AgentName | typeof MANUAL_AGENT
  inputFile: string
  model?: string
  reasoning?: string
  followUp?: boolean
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
      "--add-dir is not supported; keep review material under the review working directory.",
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
        "input-file": { type: "string" },
        model: { type: "string" },
        reasoning: { type: "string" },
        "follow-up": { type: "boolean" },
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
  const inputFile = stringValue(values["input-file"])
  if (!inputFile)
    throw new OperationalError("invalid_input", "--input-file is required")

  return {
    agent: agentValue as CliArgs["agent"],
    inputFile,
    model: stringValue(values.model),
    reasoning: stringValue(values.reasoning),
    followUp: values["follow-up"] === true || undefined,
    resumeSessionId: stringValue(values["resume-session-id"]),
    timeoutSeconds: parseIntegerOption(
      stringValue(values["timeout-seconds"]),
      "--timeout-seconds",
    ),
  }
}

export function validateArgs(args: CliArgs): void {
  const manual = args.agent === MANUAL_AGENT
  if (args.resumeSessionId?.trim() === "") {
    throw new OperationalError(
      "invalid_input",
      "--resume-session-id must not be empty",
    )
  }
  if (!manual && args.followUp) {
    throw new OperationalError(
      "invalid_input",
      "--follow-up is only for --agent manual; continue a CLI review with --resume-session-id",
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
  }
}

export async function main(
  dependencies: {
    argv?: string[]
    readInputFile?: (path: string) => Promise<string>
    cwd?: string
    loadReviewer?: LoadReviewer
    randomToken?: () => string
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

  const readInputFile =
    dependencies.readInputFile ?? ((path: string) => readFile(path, "utf8"))
  let input: RoundInput
  try {
    input = parseRoundInput(await readInputFile(args.inputFile))
  } catch (error) {
    return emitError(
      writeStdout,
      new OperationalError("invalid_input", errorMessage(error)),
    )
  }

  const manual = args.agent === MANUAL_AGENT
  const followUp = manual
    ? args.followUp === true
    : args.resumeSessionId !== undefined
  if (followUp !== input.hasResponseMarker) {
    return emitError(
      writeStdout,
      new OperationalError(
        "invalid_input",
        followUp
          ? `A follow-up round requires an '${HOST_RESPONSE_MARKER}' line before the host response.`
          : `An '${HOST_RESPONSE_MARKER}' line requires a follow-up round: pass --resume-session-id, or --follow-up with --agent manual.`,
      ),
    )
  }

  const prompt = buildPrompt({
    followUp,
    reviewMethod: await readFile(REVIEW_METHOD_PATH, "utf8"),
    reviewInput: input.reviewInput,
    hostResponse: input.hostResponse,
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
      loadReviewer: dependencies.loadReviewer,
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
): number | undefined {
  if (value === undefined) return undefined
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
    "Usage: node agent_review.ts --agent <name|manual> --input-file <path> [options]",
    "",
    `CLI agents: ${AVAILABLE_AGENTS.join(", ")}`,
    "Options: --model, --reasoning, --resume-session-id, --timeout-seconds, --follow-up (manual only)",
  ].join("\n")
}
