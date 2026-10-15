# Core development

This document records ownership and invariants for `scripts/agent_review/core.ts` and their composition in `scripts/agent_review/cli.ts`.
Keep runtime review procedure in the documents linked from `skills/agent-review/SKILL.md`.

Read [User-relay development](user-relay.md) for invariants unique to `--agent manual`.

## Ownership

Keep the transport-independent review contract in `core.ts`: stdin parsing, prompt construction, JSON extraction, normalization, and parse-repair prompts.
Keep argument parsing, validation, standard I/O, normalized output, and top-level composition in `cli.ts`.
Keep reviewer sessions, the round deadline, retries, and transport failure classification in `agentex.ts`, and runtime dependency installation in `runtime.ts`.

## Round contract

Build a full prompt only for the first round and delta-only prompts while the reviewer conversation retains the original subject.
Tell the reviewer in the full prompt not to modify files or repository state and to use tools only for inspection and read-only checks.
Limit later prompts to the host response, new review scope, and per-round values that changed.

Keep review criteria in the runtime focus document, which the host adapts and sends as review input.
Keep in the prompt only what holds for any focus: the reviewer role, the read-only rule, issue quality rules, severity definitions, and the response contract.
Have the reviewer withhold the low-severity issues it found while higher-severity issues remain open, and set `deferred_polish` only when it actually withholds one.

Select the prompt shape from the transport's continuation signal: `--resume-session-id` for CLI reviewers and `--follow-up` for `--agent manual`.
Keep round numbers out of the helper and the round budget in runtime instructions.

## Input and execution

Interpret first-round stdin as review input.
Require the literal `=== AGENT_REVIEW_RESPONSE ===` marker line in follow-up stdin, separating optional new scope above it from the host response below it.
Reject a follow-up without the marker and the marker without a follow-up signal, judged by the marker line itself rather than by the sections around it.
Reject empty input and `--follow-up` for CLI reviewers.

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
