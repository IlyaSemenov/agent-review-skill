# Running agent-review under Codex

Apply these rules only when you (the host agent) are Codex.

## Run the helper with escalation

The helper sends the review input (a diff, plan, or file paths — i.e. private project context) to the selected reviewer CLI, which may relay it to an external service.
Request sandbox escalation for every helper round without asking for confirmation beyond what [Review via CLI](../cli-review.md) requires.
A user's rule that allows the helper command lets it run without an approval request.

## Track yielded helper commands

Run the helper in the foreground through `exec_command` with a short `yield_time_ms`, such as 1000 ms, and always inspect the result for `session_id`.
Because the helper buffers reviewer output, `{session_id, output: ""}` means the process is still running, not that it completed or returned an operational error.
Save that terminal `session_id` and poll it with `write_stdin` until `exit_code` appears.

Do not launch another reviewer while the previous terminal session's state is unknown, and tell the user that the reviewer is still working when an update is due.
This terminal `session_id` is distinct from the reviewer `session_id` in the helper's final JSON used by `--resume-session-id`.

```text
result = exec_command({cmd, workdir, yield_time_ms: 1000})
if result.session_id is present:
  terminal_session_id = result.session_id
  while result.exit_code is absent:
    update the user when due
    result = write_stdin({session_id: terminal_session_id, chars: "", yield_time_ms: 30000})
interpret output only after exit_code appears
```

## When the run is blocked

A block here is the approval layer, not the helper or the reviewer CLI: it may treat the run as an outbound transfer of workspace data, even on an explicit user request.
Keep the timeout and helper unchanged, and keep the user informed instead of silently falling back to a local review.

Surface the block, quote what would be sent, and show, verbatim:

- the exact helper command you will run, and
- the confirmation wording the user needs to give for you to request escalation again — that they explicitly authorize sending this review input to the reviewer and, for OpenCode and pi, auto-approving all of the reviewer's local tool permission requests.

Put the exact helper command alone in a fenced code block.
Ask the user to reply with the confirmation wording, and put that wording alone in a separate fenced code block.
Mention that they can allow the helper permanently by adding `prefix_rule(pattern=["node", "<absolute helper path>"], decision="allow")` to `~/.codex/rules/default.rules` and restarting Codex.

Once the user gives that confirmation, request the sandbox escalation again and run the exact command shown.
That confirmation covers later rounds of the same session.
