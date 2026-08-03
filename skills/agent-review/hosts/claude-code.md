# Running agent-review under Claude Code

Apply these rules only when you (the host agent) are Claude Code.

## Always run the helper in the foreground

Run the helper command in the foreground, never with `run_in_background`. This applies to every round, including `--resume-session-id` rounds.

Why: the reviewer CLI is itself an agent and calls its own tools mid-review (shell commands, permission checks). A backgrounded Bash task can't complete those steps, so the run stalls and the wrapper reports a false `{"reason":"timeout"}` even though the reviewer would finish in ~30–60s in the foreground. (If a sandbox would also deny the command, run it escalated too — but the background launch is the usual cause.)

Set the Bash tool `timeout` to cover the helper's budget (e.g. `600000`).
The default Bash timeout is usually shorter than the helper's own `--timeout-seconds` budget, so a foreground review that legitimately runs that long gets killed by the wrapper — not the helper — wasting the round.
This is the Bash tool's limit, distinct from `--timeout-seconds` below.

## When you hit a `timeout`

A `timeout` is a launch problem, not a reviewer that couldn't finish — so don't report "reviewer couldn't finish" or debug the Python wrapper; the wrapper is correct. Two causes, two fixes:

- **Ran in the background** — rerun the exact same command in the foreground (see above). Do **not** raise `--timeout-seconds` (the helper's own budget): a bigger budget in the background just buys a longer false timeout.
- **Bash tool killed it at its default timeout** while it ran in the foreground — raise the Bash tool `timeout` to cover the helper's budget (see above), not `--timeout-seconds`.
