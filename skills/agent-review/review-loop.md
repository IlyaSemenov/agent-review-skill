# Review loop

This document defines the review loop shared by both review paths.

## Surface feedback before acting

Follow this sequence for every successful reviewer response, including the first round and all resumed rounds:

1. Give the user a concise, concrete summary of every reviewer issue.
2. Investigate and judge the issues.
3. Show the host's decision and intended action for every issue.
4. Apply accepted changes.
5. Start another round when useful.

Never make an investigation tool call before step 1 or mutate the artifact before step 3.
Immediately after each reviewer response and before investigating or editing, give the user a concise list of every reported issue, specific enough to show what may change and why it matters.

Rewrite vague reviewer titles into concrete maintainer-facing problem statements.
Do not replace the issue list with only a count or a general summary.

If the reviewer raised no issues, say so on one line.
When `deferred_polish` is true, add one line saying the reviewer withheld low-severity issues until higher-severity ones are resolved.
This update is informational, not an approval request.

Continue the review without waiting unless the user interrupts.
Track every issue internally by its stable `id`; omit ids from user-facing progress lines.

## Judge each round

Treat the reviewer as a peer rather than the final authority.
Accept useful criticism and update the artifact.
Reject criticism that is mistaken, overspecified, or based on a wrong assumption.

Reaching consensus is not required.
Treat `loop_signal: true` as evidence that another round may be unproductive, not as authority to accept the reviewer's position.

After checking the issues, but before changing the artifact or starting another round, give the user one concise decision line per issue:

- `<concrete problem summary> — accepted: <what you will change>`
- `<concrete problem summary> — rejected: <one-line reason>`

Do not edit the artifact before sending this decision update.
The decision update is informational, not an approval request.
Continue immediately with accepted changes unless the user interrupts.

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
Do not stop because no actionable issues remain while `deferred_polish` is true; run another round to receive the withheld issues.

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

If the loop stopped while `deferred_polish` was true, state that low-severity issues were withheld and not reviewed.

If unresolved `open_questions` remain, add an **Open questions** group with one line per question.
Omit questions already answered during the loop.
