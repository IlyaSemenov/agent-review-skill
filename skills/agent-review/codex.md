# Running agent-review under Codex

Host-agent notes for Codex; read alongside `SKILL.md`.

## Confirm before the first review with an external reviewer

The helper sends the review input (a diff, plan, or file paths — i.e. private
project context) to the selected reviewer CLI. When that reviewer ships the
context to an external service — `claude`, or `opencode` pointed at an external
provider — Codex's approval layer treats the run as an outbound transfer of
workspace data and blocks it, even on an explicit user request. A reviewer that
stays local (a self-hosted model, or `opencode` on a local provider) does not
trigger this.

So before the **first** review of a session that uses an external reviewer, ask
the user once to confirm. Do not ask again for later rounds of the same session.

Show, verbatim:

- the exact helper command you will run (including `--agent` and `--model`), and
- the confirmation wording the user needs to give for you to request escalation
  — that they explicitly authorize sending this review input to the external
  service.

Once the user gives that confirmation, request the sandbox escalation and run the
exact command shown. This does not bypass permissions — it makes the escalation
explicit and auditable.

## When the run is blocked

A block here is the approval layer, not the helper or the reviewer CLI. Do not
raise `--timeout-seconds`, edit the helper, or fall back to a silent local
review without telling the user. Surface the block, quote what would be sent,
and ask for the confirmation above.
