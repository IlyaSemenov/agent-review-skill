# Running agent-review under Claude Code

Apply these rules only when you (the host agent) are Claude Code.

## Run the helper as a background task

Run every helper round, including `--resume-session-id` rounds, as one Bash call with `run_in_background: true`.
The helper's default budget exceeds the foreground Bash timeout ceiling, while a background task runs until the helper returns.

After launching, tell the user that the round is running and wait for the task-completion notification.
Do not poll the task, and do not launch the round through a subagent.
When the notification arrives, read the helper JSON from the task output file.

Do not lower `--timeout-seconds` to fit a Bash timeout.

## When the round fails

- **The task exited without helper JSON** — report it as a launch failure with the task output, not as a reviewer result.
- **The helper returned `reason: timeout`** — stop the review without raising `--timeout-seconds` or retrying automatically, and let the user decide what to do next.

## When the run is blocked

A denied helper command is Claude Code's permission layer, not the helper or the reviewer CLI: in auto mode, its classifier may treat the run as an outbound transfer of workspace data.
Keep the timeout and helper unchanged, and keep the user informed instead of silently falling back to a local review.

Surface the block, quote what would be sent, and ask the user to explicitly authorize sending this review input to the reviewer.
Mention that they can allow the helper permanently by adding `Bash(node <absolute helper path> *)` to `permissions.allow` in `~/.claude/settings.json`.

Once the user gives that authorization, run the exact command again.
That authorization covers later rounds of the same session.
