export const HOST_RESPONSE_MARKER = "=== AGENT_REVIEW_RESPONSE ==="
const ISSUE_KEYS = [
  "id",
  "title",
  "severity",
  "recommendation",
  "rationale",
] as const

const OUTPUT_KEYS = [
  "verdict",
  "issues",
  "open_questions",
  "loop_signal",
  "approval_reason",
] as const
const VERDICTS = ["approve", "needs_changes", "discuss"] as const
const SEVERITIES = ["blocker", "major", "minor", "polish"] as const

export type Review = {
  verdict: (typeof VERDICTS)[number]
  issues: Array<{
    id: string
    title: string
    severity: (typeof SEVERITIES)[number]
    recommendation: string
    rationale: string
  }>
  open_questions: string[]
  loop_signal: boolean
  approval_reason: string
}

export class OperationalError extends Error {
  reason: string

  constructor(reason: string, message: string) {
    super(message)
    this.name = "OperationalError"
    this.reason = reason
  }
}

export type RoundInput = {
  reviewInput?: string
  hostResponse?: string
  hasResponseMarker: boolean
}

export function parseRoundInput(payload: string): RoundInput {
  const emptyInputMessage =
    "Review input is empty. Put review material in the file passed to --input-file. " +
    `Use either plain review input or, for a follow-up, an '${HOST_RESPONSE_MARKER}' line before the host response.`
  const stripped = payload.trim()
  if (!stripped) throw new Error(emptyInputMessage)

  const lines = payload.split(/\r?\n/)
  const markerIndex = lines.findIndex(
    (line) => line.trim() === HOST_RESPONSE_MARKER,
  )
  if (markerIndex === -1)
    return { reviewInput: stripped, hasResponseMarker: false }

  const reviewInput = lines.slice(0, markerIndex).join("\n").trim() || undefined
  const hostResponse =
    lines
      .slice(markerIndex + 1)
      .join("\n")
      .trim() || undefined
  if (reviewInput === undefined && hostResponse === undefined)
    throw new Error(emptyInputMessage)
  return { reviewInput, hostResponse, hasResponseMarker: true }
}

export function buildPrompt(options: {
  followUp: boolean
  reviewMethod: string
  reviewInput?: string
  hostResponse?: string
  manualRoundToken?: string
}): string {
  const {
    followUp,
    reviewMethod,
    reviewInput,
    hostResponse,
    manualRoundToken,
  } = options
  const initialRound = !followUp
  const sections = initialRound
    ? [
        "You are reviewing the host agent's work as a peer reviewer, not as the final authority.",
        "Your job is to find what the host agent missed by applying the review method below to the review input, following the review focus stated in it.",
        "The method is written for a code change; apply it to other subjects as far as its criteria fit.",
        "Act only as a reviewer: do not modify files or repository state, and use tools only for inspection and read-only checks.",
        "The review material may come from this prompt, the resumed session context, inline material, file paths to inspect, or a combination of those. If it refers to files, read only the files needed for the review.",
        "Accept that some concerns may be rejected; consensus is unnecessary when the artifact is defensible.",
        "",
        "<review_method>",
        reviewMethod.trim(),
        "</review_method>",
      ]
    : []

  if (hostResponse !== undefined) {
    if (sections.length > 0) sections.push("")
    sections.push(
      "Host agent response to your previous feedback:",
      hostResponse.trim(),
    )
  }

  if (reviewInput !== undefined) {
    if (sections.length > 0) sections.push("")
    sections.push(
      initialRound ? "Review input:" : "New review input:",
      reviewInput.trimEnd(),
    )
  }

  if (!initialRound) {
    if (manualRoundToken !== undefined) {
      sections.push(
        "",
        `In your JSON response, set manual_review_token to the string ${JSON.stringify(manualRoundToken)} exactly.`,
      )
    }
    return `${sections.join("\n")}\n`
  }

  let responseInstruction = "Return exactly one bare JSON object."
  let schemaDescription = describeSchema()
  if (manualRoundToken !== undefined) {
    responseInstruction =
      "Return exactly one quadruple-backtick code fence containing a single JSON object."
    schemaDescription = `${schemaDescription}\n- manual_review_token: string, exactly ${JSON.stringify(manualRoundToken)}`
  }

  sections.push(
    "",
    responseInstruction,
    "It must have exactly these keys:",
    schemaDescription,
    "Choose verdict=approve only when no actionable issues remain.",
    "Choose verdict=needs_changes when the artifact should change.",
    "Choose verdict=discuss when the round is mainly about disagreement or clarification.",
    "Set loop_signal=true when you are substantially repeating a contested point or another exchange is unlikely to add useful information.",
    "",
    "Report the method's findings and polish as issues with their severity; put the harm in rationale and the proposed change in recommendation.",
    "Group polish of one kind into a single issue that lists every location.",
    "Complete every pass of the review method in every round.",
    "In approval_reason, name each pass you completed and what it covered.",
    "Report polish you skipped in code that a finding proposes to rewrite or delete once that finding is settled: the host fixed it, or rejected it and you accept the rejection.",
    "Put the method's open questions and material problems outside the subject in open_questions, and say when a question needs the user's decision rather than the host's.",
    "Leave out alternatives and residual risks unless they need a decision; put those in open_questions.",
    "If there are no issues, return an empty issues array.",
  )
  return `${sections.join("\n")}\n`
}

function describeSchema(): string {
  return [
    `- verdict: one of ${VERDICTS.join(", ")}`,
    `- issues: array of objects, each with exactly: ${ISSUE_KEYS.join(", ")}`,
    `    - severity: one of ${SEVERITIES.join(", ")}`,
    "    - id: a short stable identifier for the issue",
    "- open_questions: array of strings",
    "- loop_signal: boolean",
    "- approval_reason: string",
  ].join("\n")
}

export function looksLikeReviewPayload(
  value: unknown,
): value is Record<string, unknown> {
  return isRecord(value) && OUTPUT_KEYS.every((key) => key in value)
}

export function normalizeReview(payload: unknown): Review {
  if (!looksLikeReviewPayload(payload)) {
    throw new Error("Agent response does not match the expected review payload")
  }

  const verdict = payload.verdict
  if (
    typeof verdict !== "string" ||
    !VERDICTS.includes(verdict as Review["verdict"])
  ) {
    throw new Error(`Unsupported verdict: ${String(verdict)}`)
  }

  if (!Array.isArray(payload.issues)) throw new Error("issues must be a list")
  const issues = payload.issues.map((issue, index) => {
    if (!isRecord(issue))
      throw new Error(`issue #${index + 1} must be an object`)
    const severity = issue.severity
    if (
      typeof severity !== "string" ||
      !SEVERITIES.includes(severity as Review["issues"][number]["severity"])
    ) {
      throw new Error(
        `issue #${index + 1} has unsupported severity: ${String(severity)}`,
      )
    }
    const normalized = {
      id: String(issue.id ?? "").trim(),
      title: String(issue.title ?? "").trim(),
      severity: severity as Review["issues"][number]["severity"],
      recommendation: String(issue.recommendation ?? "").trim(),
      rationale: String(issue.rationale ?? "").trim(),
    }
    if (Object.values(normalized).some((value) => !value)) {
      throw new Error(`issue #${index + 1} has empty required fields`)
    }
    return normalized
  })

  if (
    !Array.isArray(payload.open_questions) ||
    !payload.open_questions.every((item) => typeof item === "string")
  ) {
    throw new Error("open_questions must be a list of strings")
  }
  if (typeof payload.loop_signal !== "boolean")
    throw new Error("loop_signal must be a boolean")
  if (typeof payload.approval_reason !== "string") {
    throw new Error("approval_reason must be a string")
  }

  return {
    verdict: verdict as Review["verdict"],
    issues,
    open_questions: payload.open_questions
      .map((item) => item.trim())
      .filter(Boolean),
    loop_signal: payload.loop_signal,
    approval_reason: payload.approval_reason.trim(),
  }
}

export function buildRepairPrompt(parseError: string): string {
  return [
    "Your previous response did not match the required structured JSON output.",
    `Parsing error: ${parseError}`,
    "Return exactly one bare JSON object matching the same schema as before.",
    "",
  ].join("\n")
}

export function parseJsonObject(text: string): Record<string, unknown> {
  const stripped = stripCodeFence(text)
  let directError: unknown
  try {
    const value = JSON.parse(stripped) as unknown
    if (!isRecord(value)) throw new Error("text payload is not a JSON object")
    return value
  } catch (error) {
    directError = error
  }

  const candidates: Array<{
    length: number
    end: number
    value: Record<string, unknown>
  }> = []
  for (let start = 0; start < stripped.length; start += 1) {
    if (stripped[start] !== "{") continue
    const end = findObjectEnd(stripped, start)
    if (end === -1) continue
    try {
      const value = JSON.parse(stripped.slice(start, end)) as unknown
      if (isRecord(value)) candidates.push({ length: end - start, end, value })
    } catch {
      // Continue scanning for another complete object.
    }
  }
  if (candidates.length === 0) throw directError
  candidates.sort(
    (left, right) => right.length - left.length || right.end - left.end,
  )
  const [candidate] = candidates
  if (!candidate) throw directError
  return candidate.value
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function stripCodeFence(text: string): string {
  const stripped = text.trim()
  if (!stripped.startsWith("```")) return stripped
  const lines = stripped.split(/\r?\n/).slice(1)
  if (lines.length > 0 && lines.at(-1)?.trim().startsWith("```")) lines.pop()
  return lines.join("\n").trim()
}

function findObjectEnd(text: string, start: number): number {
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const character = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (character === "\\") escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') inString = true
    else if (character === "{") depth += 1
    else if (character === "}") {
      depth -= 1
      if (depth === 0) return index + 1
    }
  }
  return -1
}
