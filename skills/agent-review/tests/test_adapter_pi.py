import json
import subprocess

import pytest

from adapters import AgentStreamError, OperationalError
from adapters.pi import PiAgent

SCHEMA = {"type": "object", "additionalProperties": False}
SESSION_ID = "019fc620-3a0c-7362-96e2-50f2d663b7b2"

# Real JSONL shapes captured from pi 0.83.0 using a local in-process provider.
SUCCESS_JSONL = "\n".join(
    [
        json.dumps(
            {
                "type": "session",
                "version": 3,
                "id": SESSION_ID,
                "cwd": "/repo",
            }
        ),
        json.dumps({"type": "agent_start"}),
        json.dumps(
            {
                "type": "message_end",
                "message": {
                    "role": "assistant",
                    "content": [
                        {
                            "type": "text",
                            "text": json.dumps(
                                {
                                    "verdict": "approve",
                                    "issues": [],
                                    "open_questions": [],
                                    "loop_signal": False,
                                    "approval_reason": "ok",
                                }
                            ),
                        }
                    ],
                    "stopReason": "stop",
                },
            }
        ),
        json.dumps({"type": "agent_settled"}),
    ]
)

ERROR_JSONL = "\n".join(
    [
        json.dumps({"type": "session", "version": 3, "id": SESSION_ID}),
        json.dumps(
            {
                "type": "message_end",
                "message": {
                    "role": "assistant",
                    "content": [],
                    "stopReason": "error",
                    "errorMessage": "authentication failed: missing API key",
                },
            }
        ),
    ]
)


def _build(resume_session_id=None, add_dirs=None, model=None, reasoning=None):
    return PiAgent().build_command(
        schema=SCHEMA,
        resume_session_id=resume_session_id,
        add_dirs=add_dirs or [],
        model=model,
        reasoning=reasoning,
    )


def _completed(returncode=1, stdout="", stderr=""):
    return subprocess.CompletedProcess(
        args=["pi"], returncode=returncode, stdout=stdout, stderr=stderr
    )


class TestBuildCommand:
    def test_round_one_uses_json_and_trusted_reviewer_tools(self):
        inv = _build()
        assert inv.argv[:3] == ["pi", "--mode", "json"]
        assert inv.argv[inv.argv.index("--tools") + 1] == "read,bash,grep,find,ls"
        assert "--session" not in inv.argv
        assert inv.cleanup_paths == []

    def test_resume(self):
        inv = _build(resume_session_id="session-1")
        assert inv.argv[inv.argv.index("--session") + 1] == "session-1"

    def test_no_model_or_reasoning_by_default(self):
        inv = _build()
        assert "--model" not in inv.argv
        assert "--thinking" not in inv.argv

    def test_model_and_reasoning(self):
        inv = _build(model="openai/gpt-5.5", reasoning="high")
        assert inv.argv[inv.argv.index("--model") + 1] == "openai/gpt-5.5"
        assert inv.argv[inv.argv.index("--thinking") + 1] == "high"

    def test_add_dirs_need_no_cli_flag(self):
        inv = _build(add_dirs=["/tmp/material"])
        assert "--add-dir" not in inv.argv
        assert inv.argv[:3] == ["pi", "--mode", "json"]


class TestExtractPayload:
    def test_success(self):
        payload = PiAgent().extract_payload(SUCCESS_JSONL)
        assert payload["verdict"] == "approve"
        assert payload["approval_reason"] == "ok"

    def test_takes_last_assistant_message_end(self):
        earlier = json.dumps(
            {
                "type": "message_end",
                "message": {
                    "role": "assistant",
                    "content": [{"type": "text", "text": '{"verdict":"needs_changes"}'}],
                    "stopReason": "toolUse",
                },
            }
        )
        assert PiAgent().extract_payload(earlier + "\n" + SUCCESS_JSONL)["verdict"] == "approve"

    def test_joins_text_blocks(self):
        event = json.dumps(
            {
                "type": "message_end",
                "message": {
                    "role": "assistant",
                    "content": [
                        {"type": "text", "text": '{"verdict":'},
                        {"type": "text", "text": '"approve"}'},
                    ],
                    "stopReason": "stop",
                },
            }
        )
        assert PiAgent().extract_payload(event) == {"verdict": "approve"}

    def test_no_assistant_text_raises(self):
        with pytest.raises(ValueError, match="no assistant"):
            PiAgent().extract_payload(json.dumps({"type": "agent_settled"}))

    def test_error_message_raises_stream_error(self):
        with pytest.raises(AgentStreamError, match="missing API key"):
            PiAgent().extract_payload(ERROR_JSONL)

    def test_recoverable_error_before_success_returns_final_payload(self):
        retry_events = "\n".join(
            [
                json.dumps({"type": "compaction_start", "reason": "overflow"}),
                json.dumps(
                    {
                        "type": "message_end",
                        "message": {
                            "role": "assistant",
                            "content": [
                                {"type": "text", "text": '{"verdict":"approve"}'}
                            ],
                            "stopReason": "stop",
                        },
                    }
                ),
            ]
        )
        payload = PiAgent().extract_payload(ERROR_JSONL + "\n" + retry_events)
        assert payload == {"verdict": "approve"}

    def test_terminal_error_after_success_raises_stream_error(self):
        with pytest.raises(AgentStreamError, match="missing API key"):
            PiAgent().extract_payload(SUCCESS_JSONL + "\n" + ERROR_JSONL)

    def test_non_object_raises(self):
        event = json.dumps(
            {
                "type": "message_end",
                "message": {
                    "role": "assistant",
                    "content": [{"type": "text", "text": "[1,2,3]"}],
                    "stopReason": "stop",
                },
            }
        )
        with pytest.raises(ValueError, match="not a JSON object"):
            PiAgent().extract_payload(event)

    def test_strips_json_code_fence(self):
        event = json.dumps(
            {
                "type": "message_end",
                "message": {
                    "role": "assistant",
                    "content": [
                        {"type": "text", "text": '```json\n{"verdict":"approve"}\n```'}
                    ],
                    "stopReason": "stop",
                },
            }
        )
        assert PiAgent().extract_payload(event) == {"verdict": "approve"}

    def test_extracts_review_object_after_captured_leading_prose(self):
        payload = {
            "verdict": "needs_changes",
            "issues": [{"id": "captured-drift", "title": "Example"}],
        }
        text = "I've reviewed the changeset. Here's my assessment.\n\n" + json.dumps(
            payload
        )
        event = json.dumps(
            {
                "type": "message_end",
                "message": {
                    "role": "assistant",
                    "content": [{"type": "text", "text": text}],
                    "stopReason": "stop",
                },
            }
        )
        assert PiAgent().extract_payload(event) == payload

    def test_extracts_review_object_before_trailing_prose(self):
        event = json.dumps(
            {
                "type": "message_end",
                "message": {
                    "role": "assistant",
                    "content": [
                        {
                            "type": "text",
                            "text": '{"verdict":"approve"}\nReview complete.',
                        }
                    ],
                    "stopReason": "stop",
                },
            }
        )
        assert PiAgent().extract_payload(event) == {"verdict": "approve"}

    def test_prose_without_json_object_remains_a_parse_error(self):
        event = json.dumps(
            {
                "type": "message_end",
                "message": {
                    "role": "assistant",
                    "content": [{"type": "text", "text": "Review complete."}],
                    "stopReason": "stop",
                },
            }
        )
        with pytest.raises(json.JSONDecodeError):
            PiAgent().extract_payload(event)

    def test_ignores_non_json_lines(self):
        assert PiAgent().extract_payload("noise\n" + SUCCESS_JSONL)["verdict"] == "approve"


class TestExtractSessionId:
    def test_from_session_header(self):
        assert PiAgent().extract_session_id(SUCCESS_JSONL) == SESSION_ID

    def test_missing(self):
        assert PiAgent().extract_session_id(json.dumps({"type": "agent_start"})) is None

    def test_blank_output(self):
        assert PiAgent().extract_session_id("") is None


class TestResumeCommand:
    def test_command(self):
        assert PiAgent().resume_command("abc") == "pi --session abc"


class TestClassifyFailure:
    def test_stream_failure(self):
        err = PiAgent().classify_failure(_completed(returncode=0, stdout=ERROR_JSONL))
        assert isinstance(err, OperationalError)
        assert err.reason == "auth_unavailable"
        assert "missing API key" in err.message

    def test_stderr_auth_failure(self):
        err = PiAgent().classify_failure(_completed(stderr="No API key found"))
        assert err.reason == "auth_unavailable"

    def test_generic_failure(self):
        err = PiAgent().classify_failure(_completed(stderr="model unavailable"))
        assert err.reason == "agent_cli_failed"
        assert err.message == "model unavailable"

    def test_pi_state_permission_failure(self):
        message = (
            "EPERM: operation not permitted, mkdir "
            "'/Users/reviewer/.pi/agent/settings.json.lock'"
        )
        err = PiAgent().classify_failure(_completed(stderr=message))
        assert err.reason == "sandbox_restriction"
        assert err.message == message

    def test_pi_state_permission_failure_from_stream(self):
        message = (
            "EPERM: operation not permitted, open "
            "'/Users/reviewer/.pi/agent/sessions/review.jsonl'"
        )
        stream = ERROR_JSONL.replace(
            "authentication failed: missing API key",
            message,
        )
        err = PiAgent().classify_failure(_completed(returncode=0, stdout=stream))
        assert err.reason == "sandbox_restriction"
        assert err.message == message

    def test_unrelated_permission_failure_remains_generic(self):
        err = PiAgent().classify_failure(
            _completed(stderr="Permission denied: /repo/private.txt")
        )
        assert err.reason == "agent_cli_failed"

    def test_unknown_when_empty(self):
        assert PiAgent().classify_failure(_completed()).message == "unknown error"
