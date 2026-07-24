# Adapter development

This document records adapter boundaries and the workflow for changing a reviewer CLI integration.
Keep shared orchestration rules in [Core development](core.md).

## Boundary

Implement one `ReviewAgent` module per CLI and register it in `scripts/adapters/__init__.py`.
Keep reviewer-name branches out of `scripts/agent_review.py`.

Adapters own CLI argv, temporary invocation files, raw payload and session-id extraction, interactive resume commands, and CLI-specific failure classification.
They do not own stdin parsing, prompt construction, review normalization, parse-repair policy, or loop policy.

## Adding or changing an adapter

Verify the real CLI with a live run before encoding or changing its contract.
Cover stdin, noninteractive and resume invocation, output and failure events, session ids, schema enforcement, extra directories, model and reasoning flags, and interactive resume syntax.
Build fixtures from captured CLI output rather than documentation or invented examples.

Keep model and reasoning values opaque to the core and pass them again on resume.

Add focused tests in `tests/test_adapter_<name>.py`.
Keep the concrete reviewer list only in `skills/agent-review/SKILL.md` and `README.md`, and update both when adding an adapter.
Dogfood a new adapter on this repository after its focused tests pass.
