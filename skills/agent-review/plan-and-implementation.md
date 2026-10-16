# Plan and implementation

Follow this document when the review subject is a plan that you will implement yourself, including when the user asks you to implement a plan whose review has already ended.
Do not follow it when the user asked only for a plan or the plan is itself the deliverable.

## Announce the workflow

With the first round, tell the user in two or three sentences:

- the stages: plan review → implementation → implementation review by the same reviewer → commit;
- that you stop after the plan review when a disagreement with the reviewer remains unresolved;
- when the plan has several parts, that you stop between parts, after each part's commit, and that saying "YOLO" skips these stops, while you still stop for decisions only the user can make and for blockers.

Do not mention YOLO when the plan has a single part.
If the user already asked for YOLO, state the mode in one line instead.

If your other instructions restrict commits or other git-state writes, ask in the same message whether you may commit and manage the working-copy git state for this task.
Otherwise, do not ask.

## Review the plan

Compose the focus according to [Review focus](review-focus.md), but exclude prose and formatting polish of the plan itself.
Keep names that will land in code in scope.

State the plan's parts explicitly, one commit each, even when there is only one.
Give independent changes separate parts.

Unless the user asked for YOLO, stop after the plan review when a disagreement with the reviewer remains unresolved.
Show the plan and the plan-review outcome, then wait.

## Implement and review each part

For each part:

1. Implement it.
2. Continue the same reviewer session.
   Above the response marker, supply the change according to the subject rules in `SKILL.md` and a fresh focus composed according to [Review focus](review-focus.md) that replaces the plan-stage focus.
   Add adherence to the agreed plan and undocumented deviations from it, and tell the reviewer to reopen a settled plan decision only on a new fact, an error, or a changed requirement.
3. Follow [Review loop](review-loop.md) until the review of the part ends.
4. Commit the part.

The soft round budget from the review loop applies separately to the plan review and to each part.

## Commit

Commit only the part's changes.
Write the message according to the project's commit conventions, or follow the style of `git log` when none are documented.
If unrelated changes in the working tree or index cannot be separated safely, stop and ask.

## Stop

The task is done after the last part's commit; stop there.

Unless the user asked for YOLO, also stop between parts, after each part's commit.
List the remaining parts; the user resumes the next one.

With YOLO, continue through all parts without stopping after the plan review or between parts.
Settle remaining disagreements yourself and report them as unresolved.
After the plan review and after each part's commit, give the same report as at a stop, then continue without waiting for the user.

Regardless of YOLO, stop at any stage on a blocker: a decision only the user can make, a hard-to-reverse operation the user has not confirmed, or a required check that keeps failing and you cannot fix.
When a review issue needs the user's decision, finish the review loop for the other issues, then stop before the next stage or commit.
The host environment's own plan-approval gates, the reviewer-trust confirmation, user-relay handoffs, and operational errors also apply regardless of YOLO.

At each stop, give the final report from the review loop.
Cover every review since the previous report, including the review of a part that a blocker interrupted before its commit.
