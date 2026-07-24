# Core development

This document records ownership and invariants for `scripts/agent_review.py`.
Keep runtime review procedure in the documents linked from `skills/agent-review/SKILL.md`.
Read [User-relay development](user-relay.md) for invariants unique to `--agent manual`.

## Ownership

Keep CLI-independent orchestration in the core: stdin parsing, prompt construction, the shared response schema, normalization, validation, parse repair, the round deadline, and normalized output.
Keep CLI command construction, raw-output extraction, session-id extraction, and CLI failure classification in adapters.

## Round contract

Build a full prompt only for round 1 and delta-only prompts while the reviewer conversation retains the original subject.
Limit later prompts to the host response, new review scope, and per-round values that changed.

Keep `--iteration` as technical state that selects the prompt shape.
Enforce `--max-iterations` only when the user supplied an explicit hard limit; keep soft loop budgeting in runtime instructions.

## Input and execution

Interpret round-1 stdin as review input and unmarked round-2+ stdin as the host response.
Use the literal `=== AGENT_REVIEW_RESPONSE ===` marker to separate optional new scope above it from the host response below it.
Reject empty input and round-1 response bundles.
Require `--resume-session-id` for CLI follow-ups but not for `--agent manual`.

Apply one wall-clock deadline to the complete round, including the single parse-repair retry.
Preserve the adapter's interactive resume command and the review working directory in normalized CLI output.

## Host-specific behavior

Keep host guidance in separate runtime documents next to `SKILL.md`.
Add a host-specific core branch only when the agent-agnostic path cannot remain correct, and confine host detection to that branch.
