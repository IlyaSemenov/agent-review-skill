# Running agent-review under Claude Code

Apply these rules only when you (the host agent) are Claude Code.

## Always run the helper in the foreground

Run the helper command in the foreground, never with `run_in_background`.
This applies to every round, including `--resume-session-id` rounds.
Foreground execution keeps the Bash invocation attached to the active review and makes its final status observable before the host continues.

Set the Bash tool `timeout` above the helper's budget (e.g. `910000` for the default budget).
The default Bash timeout is usually shorter than the helper's own `--timeout-seconds` budget, so a foreground review that legitimately runs that long can be killed by the Bash tool before the helper returns.
This is the Bash tool's limit, distinct from `--timeout-seconds` below.

## When you hit a `timeout`

A Bash tool timeout is a launch problem, not a reviewer result, so do not report "reviewer couldn't finish" or debug the helper without checking the launch mode.
Handle launch-layer timeouts separately from a helper JSON response whose reason is `timeout`:

- **Ran in the background** — rerun the exact same command in the foreground before diagnosing the helper or reviewer.
- **Bash tool killed it at its default timeout** while it ran in the foreground — raise the Bash tool `timeout` to cover the helper's budget, not `--timeout-seconds`.
- **The helper returned `reason: timeout`** — stop the review without raising `--timeout-seconds` or retrying automatically, and let the user decide what to do next.
