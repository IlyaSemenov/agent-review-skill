# Review loop

This document defines the review loop shared by both review paths.

## Judge each round

Treat the reviewer as a peer rather than the final authority.
Accept useful criticism and update the artifact.
Reject criticism that is mistaken, overspecified, or based on a wrong assumption.
Reaching consensus is not required.
Treat `loop_signal: true` as evidence that another round may be unproductive, not as authority to accept the reviewer's position.

After each round, give the user one concise line per issue:

- `<concrete problem summary> — accepted/fixed: <what changed>`
- `<concrete problem summary> — rejected: <one-line reason>`

Rewrite vague reviewer titles into concrete maintainer-facing problem statements.
If the reviewer raised no issues, say so on one line.
Track every issue internally by its stable `id`; omit ids from user-facing progress lines.

## Prepare another round

Send only accepted points and what changed, plus rejected points and why.
Do not resend the original subject or unchanged instructions.

When adding new scope, place it above the response marker:

```text
Now also review error handling in src/db.py.
=== AGENT_REVIEW_RESPONSE ===
Accepted: fixed the missing retry.
Rejected: the proposed lock is redundant.
```

Stop when the reviewer approves, no actionable issues remain, the same disagreement repeats after a substantive rebuttal, or `loop_signal` confirms that the discussion is stuck.

Use 10 rounds as a soft working budget when the user did not set a limit.
Treat that budget as a prompt to reconsider the value of continuing, not as an automatic stop.
Continue beyond it only while recent rounds are producing substantive new information or verifying meaningful changes.

Refresh the soft budget only when user-authored input materially changes the requirements or review scope.
Relayed reviewer output, an ordinary response to feedback, and fixes within the existing scope stay within the current budget.
Keep the technical iteration number and reviewer session continuous when refreshing the soft budget.

If the user explicitly sets a maximum number of rounds, keep `--max-iterations` in the fixed command template for every remaining invocation.
Treat an explicit maximum as a hard limit whose extension or reset requires the user's permission.

## Final report

Collect every issue across all rounds and deduplicate by `id`.
Use one concise line per issue and omit empty groups.

- **Fixed** — accepted issues applied to the artifact.
- **Dropped** — withdrawn, mistaken, or disproven issues that need no change.
- **Unresolved** — genuine disagreements that remain for the user to judge.

State why each dropped issue was dismissed, withdrawn, or verified as unfounded.

If unresolved `open_questions` remain, add an **Open questions** group with one line per question.
Omit questions already answered during the loop.

After review via CLI, append the last output's `resume_command` and state that it must be run from `resume_cwd`.
Put the command in a fenced code block and include it even after approval.
After review via user relay, omit the resume block.
