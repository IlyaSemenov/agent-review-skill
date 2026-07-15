# Review loop

This document defines the review loop shared by automatic and manual delivery.

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
Track every issue internally by its stable `id`, but do not expose ids in user-facing progress lines.

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

Stop when the reviewer approves, no actionable issues remain, the same disagreement repeats after a substantive rebuttal, `loop_signal` confirms that the discussion is stuck, or the configured iteration limit is reached.

## Final report

Collect every issue across all rounds and deduplicate by `id`.
Use one concise line per issue and omit empty groups.

- **Fixed** — accepted issues applied to the artifact.
- **Dropped** — withdrawn, mistaken, or disproven issues that need no change.
- **Unresolved** — genuine disagreements that remain for the user to judge.

State why each dropped issue was dismissed, withdrawn, or verified as unfounded.
Do not expose raw issue ids.

If unresolved `open_questions` remain, add an **Open questions** group with one line per question.
Omit questions already answered during the loop.

For automatic delivery, append the last output's `resume_command` and state that it must be run from `resume_cwd`.
Put the command in a fenced code block and include it even after approval.
For manual delivery, omit the resume block.
