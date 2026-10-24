# Meta-review

Follow this document when the user asks for feedback on this skill or on how a review went, rather than on the reviewed artifact.
Run a meta-review only on the user's explicit request.

## Ask the reviewer

Continue the reviewer conversation of the review the user means with an ordinary follow-up round.
If several reviews ran and the context does not settle which one, ask the user.
If the review never ran or its session is lost, write only your own view and say why the reviewer's is missing.

Above the response marker, put the meta-review request:

- The subject is the review process as the reviewer saw it — its prompts, including the review method, the review input, your responses, and the rounds — not the reviewed artifact.
- Ask what in the prompts, the review method, the review input, and the rounds helped find real problems, what was useless, redundant, or contradictory, and what was missing, each point tied to a concrete moment of this review.
- Ask which of its own findings or recommendations turned out wrong and what would have prevented them.
- Say that the helper's rules for later rounds do not apply to this round.
- State how the answer maps to the response schema for this round only:
  - `verdict` assesses the skill;
  - each improvement proposal is an issue whose severity is the cost of leaving it unfixed for future reviews and whose recommendation names the prompt passage, method section, or review-input practice to change and the change;
  - `approval_reason` explains the verdict and lists what worked and should be kept;
  - `verification` states what the conclusions rest on and what limits them;
  - `open_questions` holds decisions for the skill's maintainer.

Below the response marker, report the decisions, applied changes, and check results the reviewer has not seen yet; leave it empty when there are none.

## Add your own view

Judge each reviewer proposal: agree, partially agree, or disagree, with a one-line reason.
Add your own observations as the host on the host-side instructions you followed, each tied to a concrete moment of this review: instructions that conflicted, steps that cost time without value, information you had but the review input had no place for, and missing steps.

## Keep the review separate

Do not run the review-loop decision flow on the meta-review and do not edit the skill.
The meta round does not count toward the soft round budget, does not end a stage or allow a commit, and its issues stay out of the review's final report.
When the review continues afterwards, state above the response marker of the next round that the meta-review is over and the original subject and response contract apply again.

## Report

Give the user one report that the skill's maintainer can read without this conversation:

- a one-line assessment of how well the skill fit this review;
- what to keep;
- proposals ranked by importance, each with the reviewer's position and yours;
- your own observations that no proposal covers;
- open questions for the maintainer;
- the limits of the conclusions, such as parts of the process the reviewer did not see or a missing reviewer view.

Describe the reviewed project only as far as a proposal needs it, such as the kind of change and the problem found; leave out its code, paths, and private details.
