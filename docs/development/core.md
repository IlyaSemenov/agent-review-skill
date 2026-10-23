# Core development

This document records ownership and invariants for `scripts/agent_review/core.ts` and their composition in `scripts/agent_review/cli.ts`.
Keep runtime review procedure in the documents linked from `skills/agent-review/SKILL.md`.

Read [User-relay development](user-relay.md) for invariants unique to `--agent manual`.

## Ownership

Keep the transport-independent review contract in `core.ts`: round input parsing, prompt construction, JSON extraction, normalization, and parse-repair prompts.
Keep argument parsing, validation, input-file reading, standard output, normalized output, and top-level composition in `cli.ts`.
Keep reviewer sessions, the round deadline, retries, and transport failure classification in `agentex.ts`, and runtime dependency installation in `runtime.ts`.

## Round contract

Build a full prompt only for the first round and delta-only prompts while the reviewer conversation retains the original subject.
Tell the reviewer in the full prompt not to modify files or repository state and to use tools only for inspection and read-only checks.
Limit later prompts to the host response, new review scope, and per-round values that changed.

Send the review method, `skills/agent-review/review-method.md`, in the full prompt; it owns the review criteria, finding verification, severity, and result categories.
Keep the rules for composing the request-specific focus in the runtime focus document; the host sends the composed focus as review input.
Alongside the review method, keep in the prompt only the reviewer role, the read-only rule, the mapping of the method's results to the response contract, and the response contract.
Have the reviewer report the polish it skipped in code that a finding rewrites once that finding is settled.
Have the reviewer explain the verdict in `approval_reason` and report the checks it ran and its residual risk in `verification`.
Scope later rounds to the host's changes, the invariants they affect, the host's rebuttals, and new review input.

Select the prompt shape from the transport's continuation signal: `--resume-session-id` for CLI reviewers and `--follow-up` for `--agent manual`.
Keep round numbers out of the helper and the round budget in runtime instructions.

## Input and execution

Read round input only from the file passed to `--input-file`, so that the host's helper command consists of literal words that host permission rules can match.
Interpret first-round input as review input.
Require the literal `=== AGENT_REVIEW_RESPONSE ===` marker line in follow-up input, separating optional new scope above it from the host response below it.
Reject a follow-up without the marker and the marker without a follow-up signal, judged by the marker line itself rather than by the sections around it.
Reject empty input and `--follow-up` for CLI reviewers.

Apply one wall-clock deadline to runtime dependency installation, reviewer session startup, the review prompt, and the single parse-repair retry.
Treat it as a bound on waiting: accept a turn that completes within the transport's timeout grace period instead of discarding a finished review.
Start the parse-repair retry only when at least 30 seconds remain in that same deadline.
After malformed reviewer output, preserve `agent_cli_failed` with the parse error and raw output even when the repair attempt cannot start or times out.
Send the parse-repair retry to the same reviewer session with the current response schema.
After every round, make one bounded best-effort close of the reviewer session object; the reviewer conversation stays resumable.
After printing the result, allow agentex 10 seconds to finish its own kill escalation, then exit the helper so a reviewer process that outlives its closed session cannot keep it running.
Return the reviewer's native session id in normalized CLI output.

## Host-specific behavior

Keep host guidance in separate runtime documents next to `SKILL.md`.
Add a host-specific core branch only when the agent-agnostic path cannot remain correct, and confine host detection to that branch.
