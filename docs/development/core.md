# Core development

This document covers `scripts/agent_review.py`, shared prompts, stdin handling, the review schema, normalization, retries, timeouts, and helper output.

## Ownership

Keep all CLI-independent orchestration in `scripts/agent_review.py`.
The core owns stdin parsing, prompt construction, the response schema, normalization, validation, the parse-repair retry, the round timeout, and user-facing output.
Keep CLI command construction and raw-output extraction in adapters.

Keep `RESPONSE_SCHEMA` derived from `OUTPUT_KEYS`, `ISSUE_KEYS`, `VERDICTS`, and `SEVERITIES`.
Keep `describe_schema()` derived from the same constants so prompt instructions and validation cannot drift.

## Round prompts

Build a full prompt only for round 1.
Include the reviewer role, review rules, initial subject, response-field contract, and verdict guidance in that prompt.

Build delta-only prompts for round 2 and later.
Include only the host response to prior feedback, any new review scope, and per-round values that changed.
Apply the same rule to resumed CLI sessions and user-relayed sessions while the reviewer conversation retains the review subject.
Review via CLI verifies continuity through the resumed session id.
Review via user relay must recover with a new full prompt only when the reviewer loses the subject itself, not merely the JSON format.
Keep the original issue history and any explicit user-defined round limit across that recovery.

Keep `--iteration` as technical host/helper state that selects a full or follow-up prompt.
Keep `--max-iterations` optional and enforce it only as an explicit user-defined hard limit.
Leave the default soft budget and decisions to refresh it to the host runtime instructions.

Keep `manual_review_token` out of the shared `RESPONSE_SCHEMA`.
It is user-relay transport metadata and is the only output-field reminder that changes on each user-relayed follow-up.

## Stdin contract

Treat round-1 stdin as review input.
Treat round-2+ stdin without a marker as the host response to the reviewer.
Use the literal `=== AGENT_REVIEW_RESPONSE ===` marker to separate new review scope above it from the host response below it.
Keep the internal name `HOST_RESPONSE_MARKER` so the direction of that response remains explicit.

Reject an empty payload.
Reject a response bundle in round 1.
Require `--resume-session-id` for CLI rounds after round 1, but not with `--agent manual`.

## Review via CLI

Select an adapter through the registry and invoke it with `subprocess.run(input=prompt)`.
Pass model and reasoning values through unchanged on every round.
Give the entire round one wall-clock deadline, including the single JSON-repair retry.

Treat `AgentStreamError` as an operational failure rather than malformed JSON.
Use `classify_failure()` for both nonzero exit codes and failures reported in an exit-zero event stream.
Surface the adapter's interactive resume command and the review cwd with the normalized review.

## Review via user relay

Keep the `--agent manual` branch isolated from adapter lookup and subprocess invocation.
Emit the constructed reviewer prompt as plain text.
Reject CLI-only options instead of silently ignoring them.

## Host-environment changes

Keep host guidance in a separate document next to `SKILL.md`, such as `codex.md` or `claude-code.md`.
Use one clearly named core branch only when a host-specific code optimization is unavoidable and the agent-agnostic default remains correct.
Confine host checks to that branch.

When a sandboxed host reports `auth_unavailable`, rerun the helper with the required escalation before diagnosing reviewer authentication.
When a backgrounded reviewer reports a false timeout, fix the launch mode before changing the helper timeout.
