import json
import subprocess

import pytest

from adapters import AgentStreamError, OperationalError
from adapters.opencode import OpencodeAgent

SCHEMA = {"type": "object", "additionalProperties": False}

# Real JSONL shapes captured from `opencode run --format json` (opencode 1.17.4).
SESSION_ID = "ses_13a03519dffe2Yodtm7H2Rz4CK"
SUCCESS_JSONL = "\n".join(
    [
        json.dumps(
            {
                "type": "step_start",
                "sessionID": SESSION_ID,
                "part": {"type": "step-start", "sessionID": SESSION_ID},
            }
        ),
        json.dumps(
            {
                "type": "text",
                "sessionID": SESSION_ID,
                "part": {
                    "type": "text",
                    "sessionID": SESSION_ID,
                    "text": json.dumps(
                        {
                            "verdict": "approve",
                            "issues": [],
                            "open_questions": [],
                            "loop_signal": False,
                            "approval_reason": "ok",
                        }
                    ),
                },
            }
        ),
        json.dumps(
            {
                "type": "step_finish",
                "sessionID": SESSION_ID,
                "part": {"type": "step-finish", "reason": "stop"},
            }
        ),
    ]
)


def _build(resume_session_id=None, add_dirs=None, model=None, reasoning=None):
    return OpencodeAgent().build_command(
        schema=SCHEMA,
        resume_session_id=resume_session_id,
        add_dirs=add_dirs or [],
        model=model,
        reasoning=reasoning,
    )


def _completed(returncode=1, stdout="", stderr=""):
    return subprocess.CompletedProcess(
        args=["opencode"], returncode=returncode, stdout=stdout, stderr=stderr
    )


class TestBuildCommand:
    def test_round_one_base(self):
        inv = _build()
        assert inv.argv[:4] == ["opencode", "run", "--format", "json"]
        assert "--session" not in inv.argv
        # No positional message: prompt is fed on stdin by the core.
        assert inv.argv[-1] == "json"
        assert inv.cleanup_paths == []

    def test_resume(self):
        inv = _build(resume_session_id="ses_x")
        assert "--session" in inv.argv
        assert inv.argv[inv.argv.index("--session") + 1] == "ses_x"

    def test_no_model_or_reasoning_by_default(self):
        inv = _build()
        assert "--model" not in inv.argv
        assert "--variant" not in inv.argv

    def test_model_only(self):
        inv = _build(model="openrouter/anthropic/claude-haiku-4.5")
        assert inv.argv[inv.argv.index("--model") + 1] == "openrouter/anthropic/claude-haiku-4.5"
        assert "--variant" not in inv.argv

    def test_reasoning_maps_to_variant(self):
        inv = _build(reasoning="high")
        assert inv.argv[inv.argv.index("--variant") + 1] == "high"
        assert "--model" not in inv.argv

    def test_model_and_reasoning(self):
        inv = _build(model="zai/glm-4.6", reasoning="max")
        assert inv.argv[inv.argv.index("--model") + 1] == "zai/glm-4.6"
        assert inv.argv[inv.argv.index("--variant") + 1] == "max"

    def test_add_dirs_fails_fast(self):
        # opencode run has no "additional readable directories" flag. Rather than
        # silently dropping caller-granted dirs (a false review), build_command
        # fails with invalid_input so the gap is loud, not silent.
        with pytest.raises(OperationalError) as excinfo:
            _build(add_dirs=["/tmp"])
        assert excinfo.value.reason == "invalid_input"
        assert "add-dir" in excinfo.value.message

    def test_no_add_dirs_is_fine(self):
        inv = _build(add_dirs=[])
        assert inv.argv[:4] == ["opencode", "run", "--format", "json"]


class TestExtractPayload:
    def test_success(self):
        payload = OpencodeAgent().extract_payload(SUCCESS_JSONL)
        assert payload["verdict"] == "approve"
        assert payload["approval_reason"] == "ok"

    def test_takes_last_text_part(self):
        extra = json.dumps(
            {
                "type": "text",
                "sessionID": SESSION_ID,
                "part": {"type": "text", "text": json.dumps({"verdict": "needs_changes"})},
            }
        )
        payload = OpencodeAgent().extract_payload(SUCCESS_JSONL + "\n" + extra)
        assert payload["verdict"] == "needs_changes"

    def test_no_text_part_raises(self):
        jsonl = json.dumps({"type": "step_finish", "sessionID": SESSION_ID})
        with pytest.raises(ValueError, match="no text part"):
            OpencodeAgent().extract_payload(jsonl)

    def test_error_event_raises_stream_error(self):
        jsonl = json.dumps({"type": "error", "message": "model not found"})
        with pytest.raises(AgentStreamError, match="model not found"):
            OpencodeAgent().extract_payload(jsonl)

    def test_text_not_json_object_raises(self):
        jsonl = json.dumps(
            {"type": "text", "part": {"type": "text", "text": "[1,2,3]"}}
        )
        with pytest.raises(ValueError, match="not a JSON object"):
            OpencodeAgent().extract_payload(jsonl)

    def test_ignores_non_json_lines(self):
        payload = OpencodeAgent().extract_payload("noise\n" + SUCCESS_JSONL)
        assert payload["verdict"] == "approve"

    def test_strips_json_code_fence(self):
        fenced = "```json\n" + json.dumps(
            {
                "verdict": "approve",
                "issues": [],
                "open_questions": [],
                "loop_signal": False,
                "approval_reason": "ok",
            }
        ) + "\n```"
        jsonl = json.dumps(
            {"type": "text", "part": {"type": "text", "text": fenced}}
        )
        payload = OpencodeAgent().extract_payload(jsonl)
        assert payload["verdict"] == "approve"

    def test_strips_bare_code_fence(self):
        fenced = "```\n{\"verdict\":\"approve\"}\n```"
        jsonl = json.dumps(
            {"type": "text", "part": {"type": "text", "text": fenced}}
        )
        assert OpencodeAgent().extract_payload(jsonl) == {"verdict": "approve"}

    def test_extract_payload_single_text_event_contract(self):
        # Regression pin: the adapter assumes the complete answer is in ONE text
        # event and takes the last one. If opencode ever splits the JSON across
        # multiple text events, "last text part" captures only the final
        # fragment and this stops returning a full payload — catch that here.
        half_a = json.dumps(
            {"type": "text", "part": {"type": "text", "text": '{"verdict":"appr'}}
        )
        half_b = json.dumps(
            {"type": "text", "part": {"type": "text", "text": 'ove"}'}}
        )
        with pytest.raises(json.JSONDecodeError):
            OpencodeAgent().extract_payload(half_a + "\n" + half_b)


class TestExtractSessionId:
    def test_from_any_event(self):
        assert OpencodeAgent().extract_session_id(SUCCESS_JSONL) == SESSION_ID

    def test_missing(self):
        jsonl = json.dumps({"type": "step_finish"})
        assert OpencodeAgent().extract_session_id(jsonl) is None

    def test_blank_output(self):
        assert OpencodeAgent().extract_session_id("") is None


class TestClassifyFailure:
    def test_stderr_generic(self):
        err = OpencodeAgent().classify_failure(_completed(stderr="boom"))
        assert err.reason == "agent_cli_failed"
        assert err.message == "boom"

    def test_auth_failure(self):
        err = OpencodeAgent().classify_failure(_completed(stderr="error: missing api key"))
        assert err.reason == "auth_unavailable"

    def test_unknown_when_empty(self):
        err = OpencodeAgent().classify_failure(_completed())
        assert err.message == "unknown error"
