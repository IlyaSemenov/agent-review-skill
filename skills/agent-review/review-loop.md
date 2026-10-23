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
This update is informational, not an approval request.

Continue the review without waiting unless the user interrupts.
Track every issue internally by its stable `id`; omit ids from user-facing progress lines.
Do not number rounds or mention reviewer session ids in user-facing text.

## Judge each round

Treat the reviewer as a peer rather than the final authority.
Accept useful criticism and update the artifact.
Reject criticism that is mistaken, overspecified, or based on a wrong assumption.

Reaching consensus is not required.
Treat `loop_signal: true` as evidence that another round may be unproductive, not as authority to accept the reviewer's position.

After checking the issues, but before changing the artifact or starting another round, give the user a decision update with one concise line per issue, grouped by decision in this order:

- **Accepted** — `<concrete problem summary>: <what you will change>`.
- **Partially accepted** — `<concrete problem summary>: <what you will change>; <what you will not change and why>`.
- **Rejected** — `<concrete problem summary>: <one-line reason>`.
- **Needs your decision** — `<concrete problem summary>: <the choice the user must make>`.

Omit empty groups.
When every issue falls into one group, say so in its heading, such as "Accepted all issues:".

Do not edit the artifact before sending this decision update.
Apart from the **Needs your decision** group, the decision update is informational, not an approval request.
Continue immediately with the other issues unless the user interrupts.
Leave issues that need the user's decision unchanged until the user answers, and list unanswered ones under **Unresolved** in the final report.

## Prepare another round

Send only accepted points and what changed, rejected points and why, and points left for the user to decide.
Do not resend the original subject or unchanged instructions.

Put the response marker line in every follow-up input, with any new scope above it and the host response below it:

```text
Now also review error handling in src/db.py.
=== AGENT_REVIEW_RESPONSE ===
Accepted: fixed the missing retry.
Rejected: the proposed lock is redundant.
```

Stop when the reviewer approves, no actionable issues remain, the same disagreement repeats after a substantive rebuttal, or `loop_signal` confirms that the discussion is stuck.
After fixing an issue more severe than `polish`, or rejecting one for the first time, run another round even when no other issue remains.

Use 10 rounds as a soft working budget.
Treat that budget as a prompt to reconsider the value of continuing, not as an automatic stop.
Continue beyond it only while recent rounds are producing substantive new information or verifying meaningful changes.

Refresh the soft budget only when user-authored input materially changes the requirements or review scope.
Relayed reviewer output, an ordinary response to feedback, and fixes within the existing scope stay within the current budget.
Keep the reviewer session when refreshing the soft budget.

## Final report

Collect every issue across all rounds and deduplicate by `id`.
Use one concise line per issue and omit empty groups.

- **Fixed** — accepted issues applied to the artifact.
- **Dropped** — withdrawn, mistaken, or disproven issues that need no change.
- **Unresolved** — genuine disagreements and unanswered user decisions that remain for the user to judge.

State why each dropped issue was dismissed, withdrawn, or verified as unfounded.

If unresolved `open_questions` remain, add an **Open questions** group with one line per question.
Omit questions already answered during the loop.
