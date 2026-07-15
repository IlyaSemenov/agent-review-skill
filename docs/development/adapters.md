# Adapter development

This document defines the development contract for reviewer CLI adapters, registry entries, and verified CLI behavior.

## Protocol

Implement `ReviewAgent` from `scripts/adapters/base.py` in one module per CLI.
Register the adapter with one entry in `scripts/adapters/__init__.py`.
Do not add reviewer-name branches to `scripts/agent_review.py`.

Implement these methods:

- `build_command(*, schema, resume_session_id, add_dirs, model, reasoning) -> AgentInvocation` builds argv for round 1 or resume and returns any cleanup paths.
- `extract_payload(stdout) -> dict` extracts the review object and raises `ValueError` for unusable payloads or `AgentStreamError` for failures reported in the stream.
- `extract_session_id(stdout) -> str | None` extracts the resumable conversation id.
- `resume_command(session_id) -> str` returns the interactive command a user runs to reopen the session.
- `classify_failure(completed) -> OperationalError` maps failures to `auth_unavailable`, `agent_cli_failed`, or `invalid_input`.

Keep the adapter free of stdin parsing, review prompt construction, normalization, retries, and loop policy.

## Adding an adapter

Research the real CLI contract with a live run before writing code.
Verify stdin support, noninteractive invocation, output shape, session id, resume behavior, schema enforcement, model and reasoning flags, and failure signaling.
Do not infer fixtures from documentation alone.

Add `tests/test_adapter_<name>.py` with output captured from the real CLI.
Update the reviewer list and `argument-hint` in `skills/agent-review/SKILL.md`.
Update the supported-reviewer list in `README.md`.
Do not enumerate reviewers anywhere else.

## Verified CLI contracts

All supported CLIs read the prompt from stdin.

### Claude Code

Use `claude -p --output-format json --json-schema <inline>`.
Read one JSON object and take the session id from `session_id`.
Pass the model with `--model` and reasoning with `--effort`.
Use the CLI-enforced inline schema.

### Codex

Use `codex exec --json --output-schema <file> --skip-git-repo-check --sandbox read-only` for round 1.
Use `codex exec resume <id> ...` for later rounds.
Read JSONL events and take the session id from `thread.started.thread_id`.
Pass the model with `--model` and reasoning with `-c model_reasoning_effort=<value>`.
Use the schema file and keep `additionalProperties: false` on every object.

Do not pass sandbox or add-dir flags to `codex exec resume` because that subcommand rejects them.
Treat `turn.failed` and `error` events as `AgentStreamError` even when Codex exits zero.

### OpenCode

Use `opencode run --format json` and read JSONL events.
Take the session id from `sessionID`.
Pass the model with `-m provider/model` and reasoning with `--variant`.
Rely on prompt instructions and the repair retry because OpenCode has no schema-enforcement flag.

Fail fast when `add_dirs` is nonempty because OpenCode has no equivalent flag.
Treat a `type:error` event as `AgentStreamError` even when OpenCode exits zero.

## Resume and failure invariants

Pass `--model` and `--reasoning` again on every resume round.
Keep `resume_command()` in the CLI's interactive form rather than the helper's noninteractive resume form.
Classify stream-reported failures before attempting JSON repair.

Run reviewer CLIs in the foreground when their tool use cannot complete from a background process.
OpenCode is known to produce false timeouts when backgrounded.

Dogfood a new adapter on this repository's own diff with another reviewer after its focused tests pass.
