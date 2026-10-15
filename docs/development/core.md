# Core development

This document records ownership and invariants for `scripts/agent_review/core.ts` and their composition in `scripts/agent_review/cli.ts`.
Keep runtime review procedure in the documents linked from `skills/agent-review/SKILL.md`.

Read [User-relay development](user-relay.md) for invariants unique to `--agent manual`.

## Ownership

Keep the transport-independent review contract in `core.ts`: stdin parsing, prompt construction, JSON extraction, normalization, and parse-repair prompts.
Keep argument parsing, validation, standard I/O, normalized output, and top-level composition in `cli.ts`.
Keep reviewer sessions, the round deadline, retries, and transport failure classification in `agentex.ts`, and runtime dependency installation in `runtime.ts`.

## Round contract

Build a full prompt only for round 1 and delta-only prompts while the reviewer conversation retains the original subject.
Tell the reviewer in the full prompt not to modify files or repository state and to use tools only for inspection and read-only checks.
Limit later prompts to the host response, new review scope, and per-round values that changed.

Keep review criteria in the runtime focus document, which the host adapts and sends as review input.
Keep in the prompt only what holds for any focus: the reviewer role, the read-only rule, issue quality rules, severity definitions, and the response contract.
Have the reviewer withhold the low-severity issues it found while higher-severity issues remain open, and set `deferred_polish` only when it actually withholds one.

Keep `--iteration` as technical state that selects the prompt shape.
Keep the round budget in runtime instructions.

## Input and execution

Interpret round-1 stdin as review input and unmarked round-2+ stdin as the host response.
Use the literal `=== AGENT_REVIEW_RESPONSE ===` marker to separate optional new scope above it from the host response below it.

Reject empty input and round-1 response bundles.
Require `--resume-session-id` for CLI follow-ups but not for `--agent manual`.

Apply one wall-clock deadline to runtime dependency installation, reviewer session startup, the review prompt, and the single parse-repair retry.
Treat it as a bound on waiting: accept a turn that completes within the transport's timeout grace period instead of discarding a finished review.
Start the parse-repair retry only when at least 30 seconds remain in that same deadline.
After malformed reviewer output, preserve `agent_cli_failed` with the parse error and raw output even when the repair attempt cannot start or times out.
Send the parse-repair retry to the same reviewer session.
After every round, make one bounded best-effort close of the reviewer session object; the reviewer conversation stays resumable.
After printing the result, allow agentex 10 seconds to finish its own kill escalation, then exit the helper so a reviewer process that outlives its closed session cannot keep it running.
Return the reviewer's native session id in normalized CLI output.

## Host-specific behavior

Keep host guidance in separate runtime documents next to `SKILL.md`.
Add a host-specific core branch only when the agent-agnostic path cannot remain correct, and confine host detection to that branch.
