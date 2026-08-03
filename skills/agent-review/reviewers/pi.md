# Review with pi

Apply these rules only when the selected reviewer is pi.

## Run with sandbox escalation

Pi writes settings locks and resumable sessions below `~/.pi`.
Run the helper with the required sandbox escalation from the first round.
If the helper returns `sandbox_restriction`, rerun the exact command outside the sandbox.

Pi has no CLI-side response-schema enforcement.
The helper's shared prompt, validation, and repair retry enforce the review contract without host action.

## Inspect review material

Pi's inspection tools accept absolute paths directly.
Do not pass `--add-dir` for pi.

For repository changes, instruct pi to run the exact requested `git diff` command against live repository state.
For a working-tree review, also instruct pi to run `git status --short` and inspect every in-scope untracked file.
Pi may run relevant read-only checks when they help validate the review.
