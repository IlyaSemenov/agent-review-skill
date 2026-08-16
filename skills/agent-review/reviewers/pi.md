# Review with pi

Apply these rules only when the selected reviewer is pi.

## Run with sandbox escalation

The ACP transport writes state below `~/.acpx`, and its pi adapter writes settings locks and resumable sessions below `~/.pi`.
Run the helper with the required sandbox escalation from the first round.
If the helper returns `sandbox_restriction`, rerun the exact command outside the sandbox.
