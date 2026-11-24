# Review method

Review a change as a tech lead: first its value and product contract (WHY), then the solution it should have (WHAT), and only then the implementation (HOW).
Code without an obvious bug can still be a finding if it implements a harmful product decision or an objectively worse architecture.

## Context

1. Read the project's agent instructions and the project review profile, `REVIEW.md` at the repository root, if it exists; apply its checks in addition to this method.
2. Understand the change: read the diff, the changed files at the reviewed revision, the nearest patterns, and existing tests for the same scenario.
   Use the task statement when one exists — the request, the MR/PR description and discussion, the linked issue with its attachments, commit messages — as input, not as a contract.
   Read the documents for the affected area, found through the project's agent instructions, in the base version.
3. Check the change in separate passes, each over the whole change, in this order:
   1. [WHY](#purpose-and-contract-why).
   2. [WHAT](#target-solution-what).
   3. [HOW](#implementation-how): correctness, contracts and boundaries, consistency, tests, and documentation.
   4. [Placement](#placement).
   5. [Naming](#naming).
   6. [Prose](#prose).

   Complete every pass, even when the previous ones found nothing.
4. Verify every finding, see [Verifying findings](#verifying-findings).

Scale the depth by risk, not by diff size.
If the change touches authorization, money, data deletion, public contracts, migrations, concurrent operations, trust boundaries, or irreversible actions, also check the callers and consumers of the affected contract, the reasons behind the previous implementation in the history, the effect on existing data, and recovery after a failure.
For a low-risk change, keep WHY and WHAT to 1-2 lines each.

The review is static by default.
To confirm a specific suspected problem, use the shortest reliable check that leaves the working tree unchanged: an existing focused test, typecheck, or a throwaway probe script.
Run broad linters only when the review request asks for them.

## What to check

The checks below are not exhaustive: when you notice a risk outside them, check it too and verify it like any other finding.

### Purpose and contract (WHY)

- Formulate the product problem, the user, the expected outcome, and the business invariants, and check that the new rules agree with each other, with the domain model, with role permissions, and with neighboring scenarios.
  Reconstruct them from the task statement, the change, the existing behavior, and the tests; the implementation is evidence of the author's intent, not proof that the resulting behavior is right.
- For a bug fix, check that the change removes every symptom and affected surface from the report, on the report's data when it has some.
- A change that extends or reinterprets the task statement is a finding only when the product decision is harmful or contradicts an explicit requirement.
  A mockup detail may be an example rather than a requirement.
- When the change removes a guarantee that consumers get, including one preserved by an earlier decision to reject the proposed alternative, name the guarantee and the operation a consumer needs from the change, even when the task statement asks for the removal.
  Check whether that operation is possible while preserving the guarantee, such as through a narrower API; if it is and nothing else requires the removal, the removal is a finding.
  When the need stays unclear, raise an open question that names the missing requirement or constraint, and continue under an explicit assumption.
- Look for footguns — behavior that provokes a mistake, irreversible loss, a hidden data change, or a bypass of the expected process — and assess the effects on other roles, neighboring user flows, existing data, and integrations.
- If the business meaning is ambiguous, raise the assumption as an open question and continue the assessment under it.

### Target solution (WHAT)

- Determine the simplest solution that fully covers the requirements within the project's architecture: the owner of each rule, the boundaries, the minimal contracts, and the source of truth.
  Do not build in speculative flexibility.
- Do not treat the abstractions, responsibilities, or data flow chosen in the change as requirements: judge them by what the task needs, not by the fact that they already exist.
- An alternative is a finding only when you explored it enough to propose it with confidence and its advantage — less coupling or fewer entities, an explicit invariant, a restored dependency direction, simpler extension, or a lower real risk of errors — is material and worth the cost and risk of the rework.
  Otherwise report it as an alternative, or as an open question when the tradeoff needs a decision; if the implemented option is no worse, accept it.
- Report anything the change adds that is not needed as a finding, not as an alternative:
  - a second source of truth for the same rule or value;
  - state or a handler that an existing owner already covers;
  - logic that duplicates an existing function, component, or library utility instead of reusing it;
  - a layer that can be removed;
  - an abstraction or flexibility without a concrete use.
- Report runtime code as a finding when a declarative mechanism the project uses, such as CSS, a schema constraint, or a type, fully expresses the same behavior.
- Do not demand rewriting neighboring code unrelated to the change.

### Implementation (HOW)

#### Correctness

- Check real failure scenarios: edge cases, error states, repeated actions, and concurrent updates.
- Check whether a new data shape exposes data of deleted, hidden, anonymous, or inaccessible entities.
- Check that the UI shows actions to the same users the backend allows to perform them.
- If the change allocates a value that must be unique, such as `max()+1` or a counter, check that concurrent operations cannot both commit the same value.
- When the change introduces a constant — a limit, a threshold, a period — search for an existing setting or constant governing the same quantity and check that they agree.
- If the change alters a schema, an API, a storage format, configuration, or dependencies, check old and new consumers, including mixed versions during a rollout, and rollback, rerun, and partial failure of a migration.
  For a dependency upgrade, check the changelog of the versions actually used.
- When the change alters what a value means while its type stays the same, such as a function that now returns `name@version` where it returned `name`, check every consumer of that value; the type checker will not catch one that misreads the new form.
- If the change replaces an implementation of existing behavior, such as a conversion, a parser, or a query, compare the old and new results on the same inputs, especially on inputs one side cannot represent.
- When the change's behavior shows only at runtime, such as layout, rendering, animation, or timing, list the scenarios that exercise it — boundary values of its conditions, extreme sizes and content, and state changes after initialization — and check each one statically or report it as residual risk.
  A proposed fix must hold in the same scenarios.

#### Contracts and boundaries

- For each new entry point, file, and public export, check that its module and layer match the owner of its contract — domain API, transport schema, response projection, persistence, UI, or test helper — according to the project's boundary documentation.
- When the change extracts code from several places into a shared function or module, check that the extracted parts have one owner and one reason to change; code that only looks alike stays with its owners.
- Check whether new public types can express an invalid state or add unjustified optional fields.
- For a new public export, check that its declaration states the contract callers rely on; an inferred type is fine when the inferred shape is the intended contract.
- After a move or refactor, no old paths, wrappers, dead branches, or compatibility TODOs may remain unless existing consumers still need them.

#### Consistency

- File layout, the split of responsibilities into functions, error handling, and idioms must follow the neighboring code.
  A new pattern needs a reason the existing one does not fit.
- When the change follows a neighboring pattern that the project's conventions or the target solution show to be worse, report it rather than accept it for consistency.
  Name the tradeoff between consistency and the better pattern and propose the safe next step, such as applying the better pattern to the new code and moving the neighbors in a separate task; when the choice is not obvious, raise it as an open question.

#### Tests

- For each new or changed behavior contract, name the invariant it must keep and the realistic breakage a test should catch: an inverted access condition, removed error handling, a changed order of operations, or a shifted boundary value.
  For a bug fix or a behavior change, one such breakage is a return to the old behavior where the new contract requires a different outcome.
  If the tests would still pass after that breakage, they check an indirect effect or the shape of the implementation, and the gap is a finding unless you state why the risk is not real.
  Answer this mentally; do not modify files or run mutation tests.
  If the answer depends on behavior the code does not define, such as row order without `ORDER BY`, treat it as an assumption.
- Propose a test only when its expected result can be derived independently of the code under test; when a test could only restate the code, such as the branches of a template, the classes or styles it renders, or the values its own mock returns, there is no gap.
  A test in the change that restates the implementation is a finding; the fix may be to delete it.
- The fixtures must not already satisfy the expected outcome: an ordering assertion over rows inserted in the expected order, or a filter over data where every row matches, proves nothing.
- Check the test level against the project's testing conventions.

#### Documentation

- If the change alters product behavior, a workflow, a boundary, or a development rule, check the owning document, found through the project's agent instructions rather than by the nearest changed file.
  If the change alters behavior that the user-facing documentation describes, also check it.
  A statement that the change made false is a finding, also in a document the change did not touch, such as a status table row that still describes the old behavior.
- When the project's conventions govern a kind of text, such as release notes, commit messages, or MR/PR descriptions, check each new or changed text of that kind as a whole against them before checking its claims.
  Content that the conventions exclude is a finding even when it is true, such as rationale or implementation details in a release note; propose deleting it.
  In someone else's MR/PR description, report it only within the limits of the Prose checks.
- Before reviewing the wording of an addition to documentation or another text, such as a paragraph or a clause, or proposing one, check whether it is needed at all.
  Unless the project's conventions for the text require it, an addition in the change is a finding when the reader does not need it or already learns it in time from the existing documents or the product's own messages; propose deleting it.
  Drop an addition of your own, such as a cross-reference, in the same case.
  For example, a README paragraph about an error adds nothing when the command's output already explains the error.
  When fixing an existing sentence would be enough, propose that fix instead of the addition.
  Before proposing to qualify a claim, such as by naming its limits, check in the same way whether its text needs the claim at all; when it does not, propose deleting the claim instead.
  Decide this for each text where the claim appears: a detail that a guide needs may not belong in a release note.
- Check each factual claim in new or changed documentation and comments, and in wording you propose, against the contract or code it describes.
  Verify a claim about public behavior by following a public call to the value it returns, not by finding the code meant to produce that value, which another path may bypass.
  Check every case the claim covers, such as each way to reach the same data; when the claim holds only for some of them and its text needs the claim, it must name its limits.
  When a claim draws a line between correct use and a mistake, test the claim and any wording you propose against one minimal example on each side.
  For example, to check when a wrapper can finish before the operation it starts, compare a wrapper that returns the operation's promise with one that discards it.
  Include both examples in a finding about where that line falls.
- When a documented rule is drawn from one case, such as an instruction written after an incident, check that it also works in the common cases within its scope.
- Normative documentation describes the current state, not its history, and does not duplicate a rule owned elsewhere.

#### Placement

Check that each addition stands where its reader looks for it, not where it was convenient to append:

- A text fits the reader and purpose of its document and of the passage it joins: an implementation or maintenance detail does not belong in a user-facing description of behavior.
- An added text matches the level of detail of the neighboring sections: a paragraph about one rare case in a section that describes every other case in one line is a finding.
- A function, a test, or a `describe` block takes its place in the logical order of its file, such as happy path → main contract → errors → edge cases.
  The diff does not show this order: for each file where the change adds one, read the names of the existing ones in file order and check that each addition stands at its logical place among them.
  An addition appended at the end of its file or block is a finding unless the end is its logical place.

#### Naming

- Check every new or changed name: types, functions, variables, files, options, keys, and fields.
  A name that is vague, inaccurate, distorts the domain model, or breaks the project's naming pattern is an issue, not a matter of taste.
- For each new name of a domain entity or concept — in identifiers, comments, user-facing texts, and documentation — search with `rg` for how it is already named in the schema, types, API, documentation, and UI.
  Local names of variables and helpers need no search.
  A new name for an already named entity is `major` when it enters a public or persisted contract — an API, a URL, a database schema, an event — or spreads across modules; otherwise it is `minor` or `polish`.

#### Prose

- User-facing texts must read as natural product wording, rather than code identifiers or literal translations.
- Read each new or changed user-facing text, such as documentation, a release note, or a product message, as its reader: it describes what they observe, in terms they know.
  A release note says what changed for the user, such as "`sync` no longer deletes files that were never uploaded", not how the code does it now.
- When the change adds or rewrites the heading or the opening sentence of a section, or you propose one, read them together, then compare them with the whole section.
  When the change adds or rewrites the first sentence of a rule or a list item, or you propose one, compare it with the text it introduces.
  In both cases, the introduction must convey the main purpose and scope of what it introduces, rather than one use taken from an example.
- Flag filler in texts, documents, and comments: text that states the obvious, retells the code, repeats nearby text, or hedges generically.
  Propose deleting it or a tighter replacement.
- Polish an MR/PR description only when the requester of the review is its author.
  In someone else's change, report the description only for claims that would mislead the review or the merge decision.

## Verifying findings

Keep a finding only if you can answer each question:

- Which concrete scenario or consumer exposes the problem?
- What confirms it and every assumption behind it: code, a contract, a test, or documentation?
  Confirm it along the whole path the input takes, not only where you saw the condition: an earlier step may transform the input or send it elsewhere.
  For the behavior of a framework, ORM, database, or library, check the version the project actually uses, from the lockfile, even when it is not installed locally.
- Does the change introduce or materially worsen the problem, or leave unsolved what its task requires?
  When the change wraps or reimplements a library or existing code, check how that code behaves in the same scenario before attributing the behavior to the change.
  Mention a material problem that fails this check in one line as outside the change.
- What outcome must the fix achieve to remove the root cause?

Drop a finding that fails the check; do not downgrade an unproven hypothesis to `minor` or to a question.
An open product decision stays an open question under an explicit assumption, see [Purpose and contract](#purpose-and-contract-why).
If confirmation needs a runtime check you did not run, report a residual risk and name the check.

Propose the minimal change that achieves the required outcome only after checking that it works in the proposed form.
When the finding prescribes a specific shape of the fix, sketch it against the actual code and check it on every use of the API or value it changes, such as other callers and chained calls, not only where the problem shows.
When no change passes this check, give the outcome and leave the form of the fix open.

## Results

Sort what the review found into these categories:

- **Findings** — problems of severity `blocker`, `major`, or `minor`.
- **Polish** — fixes of severity `polish`.
- **Alternatives** — useful options equivalent to the implemented one or not worth the switch; not micro-style.
- **Open questions** — assumptions the conclusion rests on and decisions that need confirmation; only what affects the conclusion or further actions.
  When the answer to a question determines whether the change is needed at all, make resolving it the main conclusion of the review and name the findings and polish that should wait for the answer.
- **Residual risk** — what remained unchecked or uncertain, and material problems outside the change.

Give each finding its file and line, the concrete harm, and a concrete change rather than general advice.
If no fix is confirmed, state the required outcome instead.
When a finding proposes reworking the solution, name the tradeoff that justifies the rework.
Leave out findings withdrawn and severities changed while reasoning.

### Severity

Severity is the cost of leaving an issue unfixed.

- `blocker` — the fix cannot be deferred: behavior, access or security, data, or a public contract breaks.
- `major` — significant technical debt, an architectural mistake, a fragile contract, or an uncovered risk with a real cost.
  Deferring the fix is acceptable only as explicitly accepted technical debt; propose it as an open question and state what the debt costs.
- `minor` — a local improvement of readability, naming, a test, or documentation; explain its harm.
- `polish` — a local fix that changes neither behavior nor a contract anything relies on and whose replacement explains itself: wording, minor naming, phrasing of comments and docs, formatting, small consistency fixes.
  Removing a parameter, an export, or a branch without consumers is polish; when a consumer may exist outside the reviewed code, such as a public API, it is a finding.
  If the harm needs explaining, it is a finding.
  A wording fix is polish only when it keeps what the text covers and claims.

### Polish

Report all polish you found, even next to `blocker` or `major` findings, except mechanical formatting, such as indentation, spacing, or line wrapping, when the project configures a formatter or a linter.
Skip polish only in code that a finding proposes to rewrite or delete.
Merge polish fixes of the same kind into one, but report a finding separately from polish, even in the same passage.
