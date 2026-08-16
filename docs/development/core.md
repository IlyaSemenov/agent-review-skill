# Core development

This document records ownership and invariants for `scripts/agent_review/core.ts` and their composition in `scripts/agent_review/cli.ts`.
Keep runtime review procedure in the documents linked from `skills/agent-review/SKILL.md`.

Read [User-relay development](user-relay.md) for invariants unique to `--agent manual`.

## Ownership

Keep the transport-independent review contract in `core.ts`: stdin parsing, prompt construction, JSON extraction, normalization, and parse-repair prompts.
Keep argument parsing, validation, standard I/O, normalized output, and top-level composition in `cli.ts`.
Keep ACP sessions, the round deadline, retries, timeout cancellation, process execution, and transport failure classification in `acpx.ts`.

## Round contract

Build a full prompt only for round 1 and delta-only prompts while the reviewer conversation retains the original subject.
Tell the reviewer in the full prompt not to modify files or repository state and to use tools only for inspection and read-only checks.
Limit later prompts to the host response, new review scope, and per-round values that changed.

Keep `--iteration` as technical state that selects the prompt shape.
Enforce `--max-iterations` only when the user supplied an explicit hard limit; keep soft loop budgeting in runtime instructions.

## Input and execution

Interpret round-1 stdin as review input and unmarked round-2+ stdin as the host response.
Use the literal `=== AGENT_REVIEW_RESPONSE ===` marker to separate optional new scope above it from the host response below it.

Reject empty input and round-1 response bundles.
Require `--resume-session-id` for CLI follow-ups but not for `--agent manual`.

Apply one wall-clock deadline to session creation, ACP configuration, the review prompt, and the single parse-repair retry.
After a timeout, make one bounded best-effort ACP cancellation before returning the operational error.
Return the persistent `acpx` session name in normalized CLI output.

## Host-specific behavior

Keep host guidance in separate runtime documents next to `SKILL.md`.
Add a host-specific core branch only when the agent-agnostic path cannot remain correct, and confine host detection to that branch.
