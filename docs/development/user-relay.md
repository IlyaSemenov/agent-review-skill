# User-relay development

This document records invariants unique to user-relayed review.
Keep shared helper and prompt-construction rules in [Core development](core.md).
Keep runtime steps and examples in `skills/agent-review/user-relay.md`; do not duplicate them here.

## Invariants

Treat `manual` as a transport branch, not as an adapter: it owns no reviewer process or session.
Keep user relay host- and reviewer-agnostic and never present it as a fallback for a particular CLI reviewer.
Allow later rounds without a session id because conversation continuity belongs to the user-managed reviewer session.

Preserve the authorship boundary across lenient parsing: extracted review data is reviewer-authored feedback, while surrounding text is a user-authored comment and the only source of authorization or scope changes.
Treat malformed or missing JSON as format loss, not context loss; restart with a full prompt only when the reviewer loses the review subject itself.

Keep `manual_review_token` as advisory round-correlation metadata rather than part of the shared `RESPONSE_SCHEMA` or a validity requirement.
Serialize it as a quoted JSON string so hexadecimal values and leading zeroes are copied without type coercion.
A missing or malformed token must not discard otherwise usable feedback; a mismatch is evidence of a stale response, not proof of one.

## Validation

Use focused tests to protect manual-branch isolation, full-versus-delta prompt shape, quoted token serialization, and rejection of CLI-only options.
Dogfood changes through the actual copy-and-paste path because fence stripping, user annotations, and role confusion are relay-specific failure modes.
