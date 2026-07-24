"""Adapter for OpenCode's CLI (`opencode`).

OpenCode differs from claude/codex in one structural way: its `run` command has
no structured-output / JSON-schema flag. So unlike the other adapters we cannot
ask the CLI to enforce the schema — we rely on the prompt instructing JSON and
on the orchestrator's existing JSON-repair retry to recover from drift.

Observed `opencode run --format json` behaviour (OpenCode 1.17.x):

- Output is a JSONL stream of events. Every event carries a top-level
  `sessionID`; the resumable id is read from there (no dedicated start event).
- The model's final answer arrives as `{"type":"text", "part":{"type":"text",
  "text":"..."}}`; `part.text` holds the review JSON as a *string* (needs a
  second parse). Take the last such event.
- The prompt is read from stdin (an empty positional message), so the
  orchestrator's `input=prompt` works unchanged.
- Model is `-m provider/model`; reasoning effort is `--variant` (provider
  -specific, e.g. high/max/minimal); resume is `-s <session-id>`.
- Like codex, OpenCode needs escalated execution in a sandbox; auth/login
  failures surface on stderr with a non-zero exit.
- Backgrounded helper runs can stall during reviewer tool use and surface as
  false timeouts, so run them in the foreground.
"""

from __future__ import annotations

import json
import subprocess
from typing import Any

from .base import AgentInvocation, AgentStreamError, OperationalError


class OpencodeAgent:
    name = "opencode"

    def build_command(
        self,
        *,
        schema: dict[str, Any],
        resume_session_id: str | None,
        add_dirs: list[str],
        model: str | None,
        reasoning: str | None,
    ) -> AgentInvocation:
        # opencode has no schema flag; `schema` is intentionally unused. JSON is
        # requested in the prompt and validated by the orchestrator.
        #
        # `opencode run` has no "additional readable directories" flag (only
        # `--dir`, a single working root), so add_dirs cannot be honored. We
        # FAIL rather than drop it silently: ignoring directories the caller
        # explicitly granted would let a review pass while the agent never saw
        # the out-of-tree files it was meant to inspect (a false review).
        if add_dirs:
            raise OperationalError(
                "invalid_input",
                "The opencode agent does not support --add-dir "
                f"(requested: {', '.join(add_dirs)}). opencode can only read its "
                "working tree; move the review material in-tree or use a "
                "different agent.",
            )
        argv = ["opencode", "run", "--format", "json"]
        if model:
            argv.extend(["--model", model])
        if reasoning:
            # opencode exposes reasoning effort as --variant.
            argv.extend(["--variant", reasoning])
        if resume_session_id:
            argv.extend(["--session", resume_session_id])
        # No positional message: the prompt is supplied on stdin by the core.
        return AgentInvocation(argv)

    def extract_payload(self, stdout: str) -> dict[str, Any]:
        # Assumes the model's complete answer arrives in a single `text` event
        # (observed in opencode 1.17.x); we take the last one. If opencode ever
        # streams the answer in fragments this would capture only the final
        # chunk — test_extract_payload_single_text_event_contract pins this.
        text: str | None = None
        for event in _iter_events(stdout):
            failure = _event_failure(event)
            if failure is not None:
                # Like codex, opencode can report a failure in-stream. Route it
                # through classify_failure rather than the parse-repair path.
                raise AgentStreamError(failure)
            if event.get("type") == "text":
                part = event.get("part")
                if isinstance(part, dict) and part.get("type") == "text":
                    value = part.get("text")
                    if isinstance(value, str) and value.strip():
                        text = value

        if text is None:
            raise ValueError("opencode output has no text part")

        payload = json.loads(_strip_code_fence(text))
        if not isinstance(payload, dict):
            raise ValueError("opencode text part is not a JSON object")
        return payload

    def extract_session_id(self, stdout: str) -> str | None:
        for event in _iter_events(stdout):
            value = event.get("sessionID")
            if isinstance(value, str) and value.strip():
                return value.strip()
        return None

    def resume_command(self, session_id: str) -> str:
        return f"opencode --session {session_id}"

    def classify_failure(
        self, completed: subprocess.CompletedProcess[str]
    ) -> OperationalError:
        stderr = completed.stderr.strip()
        stdout = completed.stdout.strip()
        message = stderr or _stream_failure(completed.stdout) or stdout or "unknown error"
        if _looks_like_auth_failure(message):
            return OperationalError("auth_unavailable", message)
        return OperationalError("agent_cli_failed", message)


def _strip_code_fence(text: str) -> str:
    """Strip a leading/trailing markdown code fence, if present.

    opencode is the one adapter with no CLI schema enforcement, so a fenced
    ```json ... ``` wrapper is the most likely deviation from the prompt
    contract. Stripping it here keeps that drift from consuming the single
    JSON-repair retry. No-op for unfenced text (claude/codex never hit this).
    """
    stripped = text.strip()
    if not stripped.startswith("```"):
        return stripped
    lines = stripped.splitlines()
    # Drop the opening fence line (``` or ```json) and a closing ``` line.
    lines = lines[1:]
    if lines and lines[-1].strip().startswith("```"):
        lines = lines[:-1]
    return "\n".join(lines).strip()


def _iter_events(stdout: str) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for line in stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(event, dict):
            events.append(event)
    return events


def _event_failure(event: dict[str, Any]) -> str | None:
    if event.get("type") == "error":
        message = event.get("message")
        if isinstance(message, str):
            return message
        return "opencode error event"
    return None


def _stream_failure(stdout: str) -> str | None:
    for event in _iter_events(stdout):
        failure = _event_failure(event)
        if failure is not None:
            return failure
    return None


def _looks_like_auth_failure(message: str) -> bool:
    lowered = message.lower()
    return any(
        marker in lowered
        for marker in ("not logged in", "unauthorized", "401", "login", "credentials", "api key")
    )
