# Manual-mode development

This document defines the development contract for `--agent manual`, manual prompts, relay behavior, response interpretation, and manual-mode runtime instructions.

## Role and data flow

Reason about manual delivery with four distinct roles:

1. The developer agent changes this repository.
2. The host agent runs the helper and judges review feedback.
3. The user relays prompts and responses between the host and reviewer sessions.
4. The reviewer agent inspects the artifact and authors review JSON.

Do not write runtime instructions for roles 2–4 into the repository's developer-facing `AGENTS.md`.
Put host runtime behavior in `skills/agent-review/manual.md`, routed through `skills/agent-review/SKILL.md`.

## Delivery invariants

Keep manual delivery reviewer-agnostic and host-agnostic.
Do not present it as a Codex fallback or change the existing automatic Codex path.
Keep `manual` out of the adapter registry because it launches no reviewer CLI.
Keep `--agent` required and use `--agent manual` as the explicit delivery selection.

Emit the full reviewer prompt in round 1.
Emit only the round delta in later rounds because the user continues the same reviewer conversation.
Do not require a session id for manual follow-ups.
Treat delta-only delivery as conditional on the reviewer retaining the review subject.
Accept clearly reviewer-authored prose when the JSON format drifts instead of treating format loss as context loss.
Restart with a full manual round 1 only when the reviewer loses the review subject itself.
Keep the original issue history and total-round limit across that restart.

## Reviewer-response transport

Assume the user normally copies the contents of a rendered code block, which strips Markdown fence delimiters.
Make the host accept review JSON whether it is bare, fenced, or surrounded by user prose.
Treat the extracted JSON object as reviewer-authored data.
Treat surrounding text as a user-authored comment.
Do not interpret reviewer fields as user authorization or scope changes.

Ask the reviewer to include a fresh `manual_review_token` inside the JSON object.
Use a matching token as positive evidence that the response belongs to the current round.
Do not reject otherwise valid review JSON solely because the token or fence is missing or malformed.
When a present token differs, resolve the possible stale paste from context or ask the user before acting.

Keep the shared review fields and their meanings identical to automatic delivery.
Keep `manual_review_token` as manual-only transport metadata rather than adding it to `RESPONSE_SCHEMA`.

## Tests and dogfooding

Test that manual delivery does not load an adapter or invoke a reviewer process.
Test round 1's full prompt and later rounds' delta-only prompt separately.
Test that CLI-only options fail fast in manual mode.
Keep automatic-delivery tests proving that the normal timeout default and prompt contract remain unchanged.

Dogfood manual changes through the actual copy-and-paste UI path.
Treat failures caused by fence stripping, user annotations, or role confusion as transport-contract bugs rather than user errors.
