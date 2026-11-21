# Review focus

In round 1, the helper sends the reviewer the [review method](review-method.md).
The review focus adapts the method to the request and the subject; do not restate the method's criteria.

Compose the focus for round 1 and place it in the review input after the subject, under a `Review focus:` heading:

- Put concerns the user named first.
- State the need behind the change separately from its solution: the concrete scenario it serves, such as a user's task in the product or an operation of a library's consumer.
  If you have evidence of that need that the reviewer cannot access, such as the user's report or the consumer's code, include the relevant excerpt.
  When the solution came from another agent or an earlier review, name that source and present the solution as one candidate, unless the user explicitly chose that solution; agreeing to its cost is not such a choice.
  When you know that the change reverses a decision recorded in the project, name that decision.
- State as requirements only the decisions the user made that the reviewer cannot learn from the subject or the project, such as an exception to a project convention or a changed plan decision, with the reason when the user gave one.
- When the user narrowed the task, for example by asking you to fix one regression and leave related defects for separate work, state the outcome the change must achieve and the boundary the user set, in the user's terms rather than as a broader criterion of your own.
  When the outcome is judged against more than one revision, such as the base of the change and the revision before a regression, state which cases each revision applies to.
- When the user explicitly narrowed the review, name the parts of the method to apply.
- Add risks specific to the subject that the method does not name, such as idempotency of a queue consumer.
- Name areas to check, not your own conclusions about them.
  List changed user-facing texts, such as documentation, release notes, and product messages, among those areas.
- When you will publish texts with the change that the subject does not contain, such as a commit message, an MR/PR description, or a comment on the issue, draft them before round 1, include them in the review input, and ask the reviewer to check that each is accurate and follows the project's conventions for it, or the style of earlier ones when none are documented.
  When a later fix changes what such a text describes, update it and send the new text with the next round.

Omit the heading when nothing applies.
When adding scope in a later round, state its focus only if it differs from round 1.
When the user narrows the task in a later round, state the new outcome and boundary as for round 1 and name the earlier criteria they replace.

Do not narrow the review yourself in any round: state a check you emphasize, such as behavior equivalence of a refactoring, as a priority rather than as the only check.

When you already ran checks relevant to the subject, such as tests or browser measurements, list them with their results and what you did not verify under a `Host checks:` heading after the focus.
