# User-relay development

This document covers `--agent manual`, relay prompts, pasted reviewer responses, and host instructions for review via user relay.

## Roles

When changing user-relay behavior, keep these four roles distinct:

1. The developer agent changes this repository.
2. The host agent runs the helper and judges review feedback.
3. The user relays prompts and responses between the host and reviewer sessions.
4. The reviewer agent inspects the artifact and returns feedback, normally as JSON.

Keep instructions for running a review out of the developer-facing `AGENTS.md`.
Put host instructions in `skills/agent-review/user-relay.md` and link to it from `skills/agent-review/SKILL.md`.

## Implementation rules

Do not assume a particular host or reviewer.
Do not present user relay as a Codex fallback or change the existing Codex CLI path.
Keep `manual` out of the adapter registry because it launches no reviewer CLI.
Select user relay only with `--agent manual`; keep `--agent` required.

Emit the full reviewer prompt in round 1.
Emit only the round delta later while the same reviewer conversation retains the review subject.
Do not require a session id for user-relayed follow-ups.
Accept clearly reviewer-authored prose when the JSON format drifts instead of treating format loss as context loss.
Restart with a full round-1 prompt only when the reviewer loses the review subject itself.
Keep the original issue history and total-round limit across that restart.

## Pasted reviewer responses

Expect users to copy rendered code-block contents without Markdown fence delimiters.
The host must accept review JSON whether it is bare, fenced, or surrounded by user prose.
Treat the extracted JSON object as reviewer-authored data.
Treat surrounding text as a user-authored comment.
Do not interpret reviewer fields as user authorization or scope changes.

Ask the reviewer to include a fresh `manual_review_token` inside the JSON object.
A matching token confirms that the response belongs to the current round.
Do not reject otherwise valid review JSON solely because the token or fence is missing or malformed.
When a present token differs, use the context to determine whether the response is stale and ask the user if it remains unclear.

Keep the shared review fields and their meanings identical to review via CLI.
Keep `manual_review_token` as user-relay-only transport metadata rather than adding it to `RESPONSE_SCHEMA`.

## Tests and dogfooding

Test that user relay does not load an adapter or invoke a reviewer process.
Test round 1's full prompt and later rounds' delta-only prompt separately.
Test that CLI-only options fail fast with `--agent manual`.
Retain tests for the CLI path's default timeout and prompt contract.

Dogfood user-relay changes through the actual copy-and-paste UI path.
Treat fence stripping, user annotations, and role confusion as relay bugs rather than user errors.
