# Review focus

Compose the review focus for round 1 and place it in the review input after the subject, under a `Review focus:` heading.
The reviewer cannot read this document, so copy the selected criteria into the input as text.

## Compose the focus

Start from the default criteria below and adapt them to the request and the subject:

- Put concerns the user named first.
- Omit a default criterion only when the user explicitly narrowed the focus or the criterion cannot apply to the subject, such as tests or leftovers for a plan.
- Add risks specific to the subject that the defaults do not name, such as data migration safety or concurrency in a queue consumer.

When adding scope in a later round, state its focus only if it differs from round 1.

## Default criteria

- **Context.** Read the project's agent instructions and the documentation for the affected area. Open neighboring code that follows the same patterns and existing tests for the same behavior.
- **Purpose.** Reconstruct what the change is for, whom it affects, and which invariants it must keep. Flag contradictory rules, footguns, degraded user flows, and side effects on neighboring scenarios before design and code issues.
- **Design.** Before judging the implemented structure, sketch the simplest sufficient solution within the project's architecture: owners of each rule, boundaries, contracts, data flow, and entities. Compare it with the implementation. Flag speculative abstractions and flexibility without a concrete use.
- **Correctness.** Check real failure scenarios, edge cases, error states, repeated actions, and concurrent updates.
- **Consistency.** File layout, module boundaries, how responsibilities are split into functions, error handling, and idioms must follow the neighboring code. A new pattern needs a reason the existing one does not fit.
- **Leftovers.** After a move or refactor, no old paths, wrappers, dead branches, or compatibility shims may remain unless compatibility is required.
- **Tests.** For each new or changed behavior, name the regression test that would fail on the old code. Flag its absence when the risk is real.
- **Documentation.** When behavior, a workflow, or a rule changes, the owning document must be updated and describe the current state rather than its history.
- **Naming.** In a separate pass after the logic review, check every new or changed name: types, functions, variables, files, options, keys, and fields. A name that is vague, inaccurate, distorts the domain model, or breaks the project's naming pattern is an issue, not a matter of taste.
- **Prose.** In a separate pass, check every added or changed user-facing text, document, and code comment. Flag filler: text that is technically correct but does not help its reader because it states the obvious, retells the code, repeats nearby text, or hedges generically. Propose deleting it or a tighter replacement. User-facing text must read naturally, not as a literal rendering of code identifiers or another language.
