import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
  buildPrompt,
  HOST_RESPONSE_MARKER,
  looksLikeReviewPayload,
  normalizeReview,
  parseJsonObject,
  parseRoundInput,
} from "./core.ts"

function validPayload() {
  return {
    verdict: "approve",
    issues: [],
    open_questions: [],
    loop_signal: false,
    approval_reason: "looks good",
    verification: "read the diff",
  }
}

describe("parseRoundInput", () => {
  test("rejects empty input", () => {
    assert.throws(() => parseRoundInput(" \n"), /empty/)
  })

  test("returns plain input", () => {
    assert.deepEqual(parseRoundInput(" Review src/auth.ts "), {
      reviewInput: "Review src/auth.ts",
      hasResponseMarker: false,
    })
  })

  test("splits a marker on its own line", () => {
    const input = `Review src/auth.ts\n${HOST_RESPONSE_MARKER}\nAccepted: fixed it.`
    assert.deepEqual(parseRoundInput(input), {
      reviewInput: "Review src/auth.ts",
      hostResponse: "Accepted: fixed it.",
      hasResponseMarker: true,
    })
  })

  test("ignores an inline marker", () => {
    const input = `The document mentions ${HOST_RESPONSE_MARKER} inline.`
    assert.deepEqual(parseRoundInput(input), {
      reviewInput: input,
      hasResponseMarker: false,
    })
  })

  test("supports response-only continuation", () => {
    assert.deepEqual(parseRoundInput(`${HOST_RESPONSE_MARKER}\nRejected.`), {
      reviewInput: undefined,
      hostResponse: "Rejected.",
      hasResponseMarker: true,
    })
  })
})

describe("prompt construction", () => {
  test("builds a full first-round prompt", () => {
    const prompt = buildPrompt({
      followUp: false,
      reviewMethod: "# Review method",
      reviewInput: "Review X",
    })
    assert.match(prompt, /host agent's work/)
    assert.match(prompt, /<review_method>\n# Review method\n<\/review_method>/)
    assert.match(prompt, /Review X/)
    assert.match(prompt, /do not modify files or repository state/)
    assert.match(prompt, /approval_reason:/)
    assert.match(prompt, /verification:/)
    assert.doesNotMatch(prompt, /manual_review_token/)
  })

  test("builds a delta-only continuation", () => {
    const prompt = buildPrompt({
      followUp: true,
      reviewMethod: "# Review method",
      reviewInput: "Also inspect Y",
      hostResponse: "Fixed X",
    })
    assert.match(prompt, /^Host agent response to your previous feedback:/)
    assert.match(prompt, /New review input:/)
    assert.doesNotMatch(prompt, /host agent's work/)
    assert.doesNotMatch(prompt, /Review method/)
    assert.doesNotMatch(prompt, /approval_reason:/)
  })

  test("adds a quoted relay token", () => {
    const prompt = buildPrompt({
      followUp: false,
      reviewMethod: "# Review method",
      reviewInput: "Review X",
      manualRoundToken: "0123abcd",
    })
    assert.match(prompt, /quadruple-backtick/)
    assert.match(prompt, /manual_review_token: string, exactly "0123abcd"/)
  })
})

describe("JSON extraction and normalization", () => {
  test("parses bare, fenced, and prose-wrapped objects", () => {
    assert.equal(parseJsonObject('{"verdict":"approve"}').verdict, "approve")
    assert.equal(
      parseJsonObject('```json\n{"verdict":"approve"}\n```').verdict,
      "approve",
    )
    assert.equal(
      parseJsonObject(
        'Done.\n{"verdict":"approve","nested":{"brace":"}"}}\nThanks.',
      ).verdict,
      "approve",
    )
  })

  test("rejects arrays and prose without JSON", () => {
    assert.throws(() => parseJsonObject("[1,2,3]"), /not a JSON object/)
    assert.throws(() => parseJsonObject("Review complete"))
  })

  test("recognizes and normalizes a valid review", () => {
    assert.equal(looksLikeReviewPayload(validPayload()), true)
    const payload = {
      ...validPayload(),
      open_questions: [" one ", "", "two"],
      verification: " Ran bun test: passed. Scrolling not checked. ",
      issues: [
        {
          id: " i1 ",
          title: " Missing retry ",
          severity: "blocker",
          recommendation: " Add retry ",
          rationale: " Network operations fail ",
        },
      ],
    }
    const review = normalizeReview(payload)
    assert.deepEqual(review.open_questions, ["one", "two"])
    assert.equal(
      review.verification,
      "Ran bun test: passed. Scrolling not checked.",
    )
    const [issue] = review.issues
    assert.ok(issue)
    assert.equal(issue.id, "i1")
  })

  test("rejects malformed review fields", () => {
    const { verification: _, ...withoutVerification } = validPayload()
    assert.throws(
      () => normalizeReview(withoutVerification),
      /expected review payload/,
    )
    assert.throws(
      () => normalizeReview({ ...validPayload(), verdict: "maybe" }),
      /verdict/,
    )
    assert.throws(
      () => normalizeReview({ ...validPayload(), loop_signal: "false" }),
      /loop_signal/,
    )
    assert.throws(
      () => normalizeReview({ ...validPayload(), verification: ["tests"] }),
      /verification/,
    )
    assert.throws(
      () =>
        normalizeReview({
          ...validPayload(),
          issues: [
            {
              id: "i1",
              title: "title",
              severity: "high",
              recommendation: "fix",
              rationale: "why",
            },
          ],
        }),
      /unsupported severity: high/,
    )
    assert.throws(
      () =>
        normalizeReview({
          ...validPayload(),
          issues: [
            {
              id: "",
              title: "title",
              severity: "polish",
              recommendation: "fix",
              rationale: "why",
            },
          ],
        }),
      /empty/,
    )
  })
})
