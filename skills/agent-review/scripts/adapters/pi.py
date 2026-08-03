"""Adapter for the pi coding-agent CLI (`pi`).

Observed `pi --mode json` behaviour (pi 0.83.0):

- Output is a JSONL event stream whose first `session` event carries the
  resumable `id`.
- The complete model response arrives in an assistant `message_end` event as
  text content inside `message.content`; pi may prefix or suffix the requested
  JSON object with prose, so the adapter extracts the largest decodable object.
- Terminal provider failures can still exit 0 and surface as an assistant
  message with `stopReason: "error"`, so the adapter detects them in-stream.
- The prompt is read from stdin, model and thinking use `--model` and
  `--thinking`, and an existing conversation resumes with `--session <id>`.
- pi has no response-schema flag, so the shared prompt and repair retry enforce
  the review contract.
- The reviewer is treated as a trusted local agent and receives `bash` for live
  repository inspection; `write` and `edit` remain omitted as a role signal,
  not as a security boundary.
- pi writes settings locks and resumable sessions below `~/.pi`; sandbox
  permission failures for that state are classified separately.
"""

from __future__ import annotations

import json
import subprocess
from typing import Any

from text_json import parse_json_object

from .base import AgentInvocation, AgentStreamError, OperationalError


class PiAgent:
    name = "pi"

    def build_command(
        self,
        *,
        schema: dict[str, Any],
        resume_session_id: str | None,
        add_dirs: list[str],
        model: str | None,
        reasoning: str | None,
    ) -> AgentInvocation:
        # pi has no schema flag; the prompt requests JSON and the core validates
        # it. Its inspection tools accept absolute paths, so add_dirs needs no
        # CLI mapping and out-of-tree subjects remain directly readable.
        argv = ["pi", "--mode", "json", "--tools", "read,bash,grep,find,ls"]
        if model:
            argv.extend(["--model", model])
        if reasoning:
            argv.extend(["--thinking", reasoning])
        if resume_session_id:
            argv.extend(["--session", resume_session_id])
        return AgentInvocation(argv)

    def extract_payload(self, stdout: str) -> dict[str, Any]:
        message = _last_assistant_message(stdout)
        if message is None:
            raise ValueError("pi output has no assistant message_end text")

        failure = _message_failure(message)
        if failure is not None:
            raise AgentStreamError(failure)

        text = _assistant_text(message)
        if not text:
            raise ValueError("pi output has no assistant message_end text")

        return parse_json_object(text)

    def extract_session_id(self, stdout: str) -> str | None:
        for event in _iter_events(stdout):
            if event.get("type") == "session":
                value = event.get("id")
                if isinstance(value, str) and value.strip():
                    return value.strip()
        return None

    def resume_command(self, session_id: str) -> str:
        return f"pi --session {session_id}"

    def classify_failure(
        self, completed: subprocess.CompletedProcess[str]
    ) -> OperationalError:
        message = _stream_failure(completed.stdout)
        if message is None:
            stderr = completed.stderr.strip()
            stdout = completed.stdout.strip()
            message = stderr or stdout or "unknown error"
        if _looks_like_auth_failure(message):
            return OperationalError("auth_unavailable", message)
        if _looks_like_sandbox_failure(message):
            return OperationalError("sandbox_restriction", message)
        return OperationalError("agent_cli_failed", message)


def _assistant_text(message: dict[str, Any]) -> str:
    content = message.get("content")
    if not isinstance(content, list):
        return ""
    parts: list[str] = []
    for item in content:
        if isinstance(item, dict) and item.get("type") == "text":
            text = item.get("text")
            if isinstance(text, str):
                parts.append(text)
    return "".join(parts).strip()


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


def _last_assistant_message(stdout: str) -> dict[str, Any] | None:
    last_message: dict[str, Any] | None = None
    for event in _iter_events(stdout):
        if event.get("type") != "message_end":
            continue
        message = event.get("message")
        if isinstance(message, dict) and message.get("role") == "assistant":
            last_message = message
    return last_message


def _message_failure(message: dict[str, Any]) -> str | None:
    stop_reason = message.get("stopReason")
    if stop_reason not in ("error", "aborted"):
        return None
    error_message = message.get("errorMessage")
    if isinstance(error_message, str) and error_message.strip():
        return error_message.strip()
    return f"pi assistant message stopped with {stop_reason}"


def _stream_failure(stdout: str) -> str | None:
    message = _last_assistant_message(stdout)
    return _message_failure(message) if message is not None else None


def _looks_like_auth_failure(message: str) -> bool:
    lowered = message.lower()
    return any(
        marker in lowered
        for marker in (
            "not logged in",
            "unauthorized",
            "401",
            "login",
            "credentials",
            "api key",
            "oauth",
        )
    )


def _looks_like_sandbox_failure(message: str) -> bool:
    lowered = message.lower()
    permission_failure = any(
        marker in lowered
        for marker in ("eperm", "operation not permitted", "permission denied")
    )
    pi_state_path = "/.pi/" in lowered or "\\.pi\\" in lowered
    return permission_failure and pi_state_path
