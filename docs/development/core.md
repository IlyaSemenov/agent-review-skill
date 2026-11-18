# Core development

This document records ownership and invariants for `scripts/agent_review/core.ts` and their composition in `scripts/agent_review/cli.ts`.
Keep runtime review procedure in the documents linked from `skills/agent-review/SKILL.md`.

Read [User-relay development](user-relay.md) for invariants unique to `--agent manual`.

## Ownership

Keep the transport-independent review contract in `core.ts`: round input parsing, prompt construction, JSON extraction, normalization, and parse-repair prompts.
Keep argument parsing, validation, input-file reading, standard output, normalized output, and top-level composition in `cli.ts`.
Keep reviewer sessions, the round deadline, retries, and transport failure classification in `agentex.ts`, runtime dependency installation in `runtime.ts`, and working-tree snapshots in `snapshot.ts`.

## Round contract

Build a full prompt for the first round and a follow-up prompt for each later round while the reviewer conversation retains the original subject.
Tell the reviewer in the full prompt not to modify files or repository state and to use tools only for inspection and read-only checks.
Limit follow-up prompts to the later-round rules, the working-tree changes since the previous round, the host response, new review scope, and per-round values that changed.

Send the review method, `skills/agent-review/review-method.md`, in the full prompt; it owns the review criteria, finding verification, severity, and result categories.
Keep the rules for composing the request-specific focus in the runtime focus document; the host sends the composed focus as review input.
Tell the reviewer that the focus sets priorities and narrows the method only where it says so explicitly.
Alongside the review method, keep in the prompt only the reviewer role, the read-only rule, the mapping of the method's results to the response contract, and the response contract.
Have the reviewer explain the verdict in `approval_reason` and report the checks it ran and its residual risk in `verification`.

Start every follow-up prompt with the later-round rules, so that host text after them can replace them for one round, as a meta-review does:

- verify the host's changes, the invariants and consumers they affect, including documentation of changed behavior, and the host's rebuttals;
- check changes that implement the reviewer's own recommendations as strictly as any other change;
- review new review input, when the round has it, by every pass of the method;
- skip, for each pass, only material that the pass already covered and the changes do not affect;
- report the polish skipped in code that a finding rewrites once that finding is settled.

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

## Working-tree snapshots

Before sending the prompt of a CLI round whose working directory is in a Git work tree, record the working tree, including untracked files that are not ignored, as a tree object, and return its name as `snapshot`.
Stage into a temporary copy of the index inside the Git directory, with Git hooks disabled, so that Git leaves the repository's index and working tree untouched; clean and process filters configured in the repository still run.
Bound recording by a tenth of the round budget, at most 60 seconds, and count it against the round deadline.
Take no snapshots for `--agent manual`.

Accept `--since-snapshot` only together with `--resume-session-id`.
With it, tell the reviewer after the later-round rules one of these:

- to list the changes with `git diff --no-relative --name-status <previous> <current>`, then diff the listed paths within the review subject, if any, as `':(top,literal)<path>'` pathspecs and verify every hunk in them, including hunks the host response does not mention, finding what changed through this diff rather than by rerunning the commands of earlier review input that show the whole subject;
- that the working tree matches the previous snapshot;
- that the changes are unavailable in this round, so it checks the current review subject, as defined by the latest review input, for changes the host response does not mention.

Never fail a round because of a snapshot: when recording fails, or the previous snapshot cannot be looked up or is not a tree, run the round without the missing parts and return the reason as `snapshot_error`.
Treat only Git's "not a git repository" error as the absence of a work tree, and accept as the previous snapshot only a tree object itself, not a commit or tag that peels to one.

## Host-specific behavior

Keep host guidance in separate runtime documents next to `SKILL.md`.
Add a host-specific core branch only when the agent-agnostic path cannot remain correct, and confine host detection to that branch.
