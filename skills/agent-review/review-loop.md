# Review loop

This document defines the review loop shared by both review paths.

## Keep the subject unchanged during a round

While a round runs, until its reviewer response reaches you, do not change the review subject, such as working-tree files, a plan, or a document.
Defer changes until the round returns, including changes the user asks for, and tell the user that you will make them then.
Change the subject during a round only when the user insists.
When the subject changed during a round anyway, report those changes in the next round as [Prepare another round](#prepare-another-round) describes.

## Surface feedback before acting

Follow this sequence for every successful reviewer response, including the first round and all resumed rounds:

1. Give the user a concise, concrete summary of every reviewer issue.
2. Investigate and judge the issues.
3. Show the host's decision and intended action for every issue.
4. Apply accepted changes and rerun the checks, yours or the reviewer's, that they affect.
5. Start another round when useful.

Never make an investigation tool call before step 1 or mutate the artifact before step 3.
Immediately after each reviewer response and before investigating or editing, give the user a concise list of every reported issue, specific enough to show what may change and why it matters.
When you can judge every issue without tool calls, skip this list and give only the decision update.

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
Reject an issue when the change neither introduces nor materially worsens the problem and its task does not require solving it; report material problems of this kind under **Outside the change**.

Reaching consensus is not required.
Treat `loop_signal: true` as evidence that another round may be unproductive, not as authority to accept the reviewer's position.

When the reviewer raises an issue again after you rejected or partially accepted it, look for what is new in it, such as an argument your rebuttal did not answer or evidence you have not checked.
Also check whether your rebuttal still holds for the current artifact.
Reconsider your decision on the merits of what you find; if you keep it, explain in your decision update why the new argument or evidence does not change it.
When nothing is new and your rebuttal still holds, keep your decision and treat the issue as a repeated disagreement.

When the reviewer's `verification` names a material check you can run, run it or carry it into the final report.

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

When the answer to an open question determines whether the change is needed at all, settle it before applying fixes that depend on the answer; handle the other issues as usual.
Answer it yourself when the materials you can check settle it; otherwise put the question under **Needs your decision** once, naming the issues that wait for it.
When the change is needed, judge the waiting issues on their merits; when it is not, list them under **Dropped** with that reason.

Before adding a qualification, an example, or a reason to a text, whether a recommendation or your own fix proposes it, decide for each affected text by what its readers need and the project's conventions for its kind:

1. Whether the text needs the claim the addition concerns; when it does not, delete the claim, or the part of it the text does not need, instead.
2. Whether a claim that stays needs the addition; when it does not, leave the addition out.

After applying a change that adds or rewords a factual claim in documentation or comments, verify the claim in its final wording before the next round or the final report, whether the wording came from the reviewer's recommendation or from you.
List the cases the wording covers, such as each way to reach the same data, each outcome of the operation including a failure during cleanup, and a step that has already started.
For example, changing "may reject with the original error" to "rejects with the original error" requires checking that every failure path the sentence covers preserves that error.
Check each case against the contract or code it describes; for a claim about public behavior, run a public call it describes, since reading the code meant to produce the result is not enough.
If the evidence supports only some cases, narrow the claim to those cases, or delete it when its text does not need it.
Remove a claim you cannot verify.
When a claim you could not verify must stay, report it as unverified in the next host response, and under **Not verified** if it stays unverified when the review stops.

After applying a change that adds or rewrites the heading or the opening sentence of a section, reread the whole section and check that the heading and opening together convey its main purpose and scope, rather than one use taken from an example.

## Prepare another round

Send:

- accepted points with what changed and where;
- rejected points and why;
- points left for the user to decide;
- the user's new decisions stated as requirements, and a narrowed task stated as [Review focus](review-focus.md) describes;
- changes the user asked for outside the reviewer's points, with what changed and where;
- changes made to the subject while the previous round ran, by you or by the user, with what changed and where; when the reviewer read the subject from a source that the change affects, such as a working-tree file or a diff command over it, also mention that it may have seen either version;
- claims in your changes that remain unverified.

Do not resend the original subject or unchanged instructions.

Put the response marker line in every follow-up input, with any new scope above it and the host response below it:

```text
Now also review error handling in src/db.py.
=== AGENT_REVIEW_RESPONSE ===
Accepted: fixed the missing retry.
Rejected: the proposed lock is redundant.
```

Stop when the reviewer approves, no actionable issues remain apart from repeated disagreements, or `loop_signal` confirms that the discussion is stuck.
Run another round, even when no other issue remains, after rejecting or partially accepting an issue for the first time, after a fix that departs from the reviewer's recommendation or changes more than the place it names, and after any fix that touches authorization, data, a public contract, or concurrent operations.
Also run another round after a change to the subject that the user asked for outside the reviewer's points or that was made while a round ran.
A `polish` fix that words its recommendation differently without changing its meaning does not depart from it.
Otherwise, when every issue is fixed by applying its recommendation as proposed, stop without another round and report the fixes under **Fixed**.
Stopping ends the exchange on the current issues; run the [prose round](#prose-round) before the final report when it applies.

Use 10 rounds as a soft working budget.
Treat that budget as a prompt to reconsider the value of continuing, not as an automatic stop.
Continue beyond it only while recent rounds are producing substantive new information or verifying meaningful changes.

Refresh the soft budget only when user-authored input materially changes the requirements or review scope.
Relayed reviewer output, an ordinary response to feedback, and fixes within the existing scope stay within the current budget.
Keep the reviewer session when refreshing the soft budget.

## Prose round

The prose round is a separate round that checks how the change reads, such as its texts, names, and the order of its tests.
When the subject is a change to project files, such as a diff, a commit, a branch, or uncommitted changes, run a prose round in the same reviewer session after the exchange on the other issues stops, even when the reviewer has approved.
Skip it when no item listed below applies to the change.
When the change consists only of texts, such as documentation or prompts, put the list and the requests below into the round that first reviews the change, such as round 1 or the round that sends an implemented part of a plan, instead of running a separate round.
For other changes, run it as a separate round that checks only the items listed below; no earlier round replaces it.

Above the response marker, list the items to check, without describing any of them as done or correct:

- user-facing texts the change touches, such as documentation, release notes, and product messages, each with the document that holds the project's convention for its kind, if any;
- documentation that describes the changed behavior, even where the change does not touch it;
- changed comments;
- new functions and tests;
- texts you will publish with the change, such as a commit message or an MR/PR description.

Ask the reviewer to apply the method's Documentation, Placement, Naming, and Prose checks to the listed items, and to check the texts published with the change as [Review focus](review-focus.md) describes.
Ask it to judge each listed text in its final form, as its reader and against the project's convention for its kind, rather than by whether the text took in earlier recommendations.

Ask the reviewer to state in `verification` its conclusion for each listed item, such as "the README paragraph is not needed: the command output already explains the error", not only that it checked the item.
Tell the reviewer it may group items that need no changes under one conclusion if it names every item in the group.
Before ending the review, check that the response gives a conclusion for every listed item; for the items it skipped, run another round that asks only about them.

When a fix after the prose round changes behavior, run another round that rechecks the affected code and the texts that describe that behavior.

## Final report

Collect every issue across all rounds and deduplicate by `id`.
Use one concise line per issue and omit empty groups.

- **Fixed** — accepted issues applied to the artifact.
- **Dropped** — withdrawn, mistaken, or disproven issues that need no change, and issues rejected as outside the change that are not material.
- **Outside the change** — confirmed material problems that the change does not introduce or materially worsen and its task does not require solving, whether the reviewer raised them as issues or in `open_questions`.
- **Unresolved** — genuine disagreements and unanswered user decisions that remain for the user to judge.
- **Checked** — material checks that you or the reviewer ran, each with its result and who ran it.
- **Not verified** — material residual risk from the reviewer's `verification` that neither a later round nor your own checks covered, and claims in your changes that remain unverified.

State why each dropped issue was dismissed, withdrawn, or verified as unfounded.

For each unanswered question in `open_questions`, add one line under **Open questions** naming any issues that depend on its answer.
List the question only in this group.

### Skill feedback

While the review runs, note problems in this skill's instructions or helper that you run into, such as instructions that conflict, a step that sends or loads the same content twice, a step that costs time without value, or information you have but the review input has no place for.
Report these problems instead of changing the skill because of them during the review; issues about the reviewed artifact follow the usual flow even when the artifact is this skill.

The reviewer reports problems it runs into in `process_feedback`.
Do not list them in progress updates or judge them as issues.
When one comes from your own review input, such as material you sent twice, correct your input in later rounds and acknowledge the correction in one line of the host response, with what the reviewer should do differently, if anything; leave the other reported problems unanswered.
Assess the reviewer's observations alongside your own when preparing the final report.

Add a **Skill feedback** group to the final report for the problems that a change to the skill's instructions or helper would avoid in later reviews.
Include problems that arise only in a particular situation, such as alongside other installed skills or with a particular project layout or project files.

Write one line per problem: what happened, the situation it depends on, if any, what it cost, and the change that would avoid it.
Describe the situation in general terms, such as "the project's AGENTS.md sets review rules that conflict with the review method", and leave out the reviewed project's code, paths, and private details, so that the user can pass the group on to the skill's maintainer as is.
When the review gives several final reports, such as at each stop of a plan's implementation, list each problem only in the first report after you noted it.

## Review the next subject

When the user asks for another review in the same conversation, such as of the next commit in a series, continue the reviewer conversation of the previous review: send the new subject and its focus as new scope above the response marker.
Start a new reviewer conversation only when the user asks for one or names a different reviewer, when the previous conversation is lost, or when the new subject has nothing in common with the previous one, such as a different project or task.
