# Running agent-review under Codex

Apply these rules only when you (the host agent) are Codex.

## Confirm before the first review

The helper sends the review input (a diff, plan, or file paths — i.e. private project context) to the selected reviewer CLI, which may relay it to an external service.
Codex's approval layer treats that as an outbound transfer of workspace data and blocks the run, even on an explicit user request.
Apply the same gate to every reviewer because `--agent` and `--model` do not reliably show whether it stays local.

Ask the user once before the **first** review of a session.
That confirmation covers later rounds of the same session.

Show, verbatim:

- the exact helper command you will run (including `--agent` and `--model`), and
- the confirmation wording the user needs to give for you to request escalation — that they explicitly authorize sending this review input to the reviewer.

Once the user gives that confirmation, request the sandbox escalation and run the exact command shown.
This does not bypass permissions — it makes the escalation explicit and auditable.

## When the run is blocked

A block here is the approval layer, not the helper or the reviewer CLI.
Keep the timeout and helper unchanged, and keep the user informed instead of silently falling back to a local review.
Surface the block, quote what would be sent, and ask for the confirmation above.
