# Review focus

In round 1, the helper sends the reviewer the [review method](review-method.md).
The review focus adapts the method to the request and the subject; do not restate the method's criteria.

Compose the focus for round 1 and place it in the review input after the subject, under a `Review focus:` heading:

- Put concerns the user named first.
- State as requirements the user's decisions that the reviewer cannot learn from the subject or the project, such as an exception to a project convention or a changed plan decision.
- When the user explicitly narrowed the review, name the parts of the method to apply.
- Add risks specific to the subject that the method does not name, such as idempotency of a queue consumer.
- Name areas to check, not your own conclusions about them.
  List changed user-facing texts, such as documentation, release notes, and product messages, among those areas.
- When you will publish texts with the change that the subject does not contain, such as a commit message, an MR/PR description, or a comment on the issue, draft them before round 1, include them in the review input, and ask the reviewer to check that each is accurate and follows the project's conventions for it, or the style of earlier ones when none are documented.
  When a later fix changes what such a text describes, update it and send the new text with the next round.

Omit the heading when nothing applies.
When adding scope in a later round, state its focus only if it differs from round 1.

Do not narrow the review yourself in any round: state a check you emphasize, such as behavior equivalence of a refactoring, as a priority rather than as the only check.

When you already ran checks relevant to the subject, such as tests or browser measurements, list them with their results and what you did not verify under a `Host checks:` heading after the focus.
