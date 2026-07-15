import os
import sys

import pytest

from adapters import AgentInvocation, AgentStreamError, OperationalError
from agent_review import (
    HOST_RESPONSE_MARKER,
    ISSUE_KEYS,
    build_prompt,
    build_repair_prompt,
    describe_schema,
    looks_like_review_payload,
    main,
    normalize_review,
    parse_stdin_payload,
    request_review,
)


class TestParseStdinPayload:
    def test_empty_raises(self):
        with pytest.raises(ValueError, match="empty"):
            parse_stdin_payload("")

    def test_whitespace_only_raises(self):
        with pytest.raises(ValueError, match="empty"):
            parse_stdin_payload("   \n\n  ")

    def test_plain_input_no_marker(self):
        review_input, host_response = parse_stdin_payload("Review src/auth.py lines 40-110")
        assert review_input == "Review src/auth.py lines 40-110"
        assert host_response is None

    def test_marker_on_own_line(self):
        payload = f"Review src/auth.py\n{HOST_RESPONSE_MARKER}\nHost accepts point 1."
        review_input, host_response = parse_stdin_payload(payload)
        assert review_input == "Review src/auth.py"
        assert host_response == "Host accepts point 1."

    def test_marker_not_on_own_line_is_ignored(self):
        payload = f"Reviewing a doc that mentions {HOST_RESPONSE_MARKER} inline"
        review_input, host_response = parse_stdin_payload(payload)
        assert review_input == payload
        assert host_response is None

    def test_marker_with_empty_input_is_response_only_resume(self):
        payload = f"{HOST_RESPONSE_MARKER}\nHost response"
        review_input, host_response = parse_stdin_payload(payload)
        assert review_input is None
        assert host_response == "Host response"

    def test_marker_with_empty_response_collapses_to_none(self):
        payload = f"Review\n{HOST_RESPONSE_MARKER}\n"
        review_input, host_response = parse_stdin_payload(payload)
        assert review_input == "Review"
        assert host_response is None

    def test_marker_only_raises(self):
        with pytest.raises(ValueError, match="empty"):
            parse_stdin_payload(f"  \n{HOST_RESPONSE_MARKER}\n  ")

    def test_marker_preserves_multiline_sections(self):
        payload = (
            "Review src/auth.py\nAlso review docs/plan.md\n"
            f"{HOST_RESPONSE_MARKER}\n"
            "Accepted: r1\nRejected: r2 — bad premise"
        )
        review_input, host_response = parse_stdin_payload(payload)
        assert review_input == "Review src/auth.py\nAlso review docs/plan.md"
        assert host_response == "Accepted: r1\nRejected: r2 — bad premise"


class TestBuildPrompt:
    def test_first_round_has_no_host_response_block(self):
        prompt = build_prompt(
            iteration=1,
            review_input="Review X",
            host_response=None,
        )
        assert "Round:" not in prompt
        assert "remaining rounds" not in prompt
        assert "Review X" in prompt
        assert "Primary agent response" not in prompt
        assert "manual_review_token" not in prompt

    def test_later_round_includes_host_response(self):
        prompt = build_prompt(
            iteration=3,
            review_input="Review X",
            host_response="Host accepted r1.",
        )
        assert "Round:" not in prompt
        assert "Primary agent response" in prompt
        assert "Host accepted r1." in prompt
        assert "New review input:" in prompt
        assert "You are reviewing" not in prompt
        assert "It must have exactly these keys" not in prompt

    def test_later_round_can_continue_without_new_review_input(self):
        prompt = build_prompt(
            iteration=3,
            review_input=None,
            host_response="Host accepted r1.",
        )
        assert prompt.startswith("Primary agent response to your previous feedback:\n")
        assert "No new review input" not in prompt
        assert "response marker" not in prompt
        assert "Review input:" not in prompt
        assert "You are reviewing" not in prompt
        assert "verdict:" not in prompt

    def test_user_relay_requests_quadruple_fenced_json(self):
        prompt = build_prompt(
            iteration=1,
            review_input="Review X",
            host_response=None,
            manual_round_token="a1b2c3d4",
        )
        assert "exactly one quadruple-backtick code fence" in prompt
        assert "manual_review_token: exactly a1b2c3d4" in prompt
        assert "outside that fence" not in prompt

    def test_user_relay_followup_contains_only_round_delta_and_token(self):
        prompt = build_prompt(
            iteration=2,
            review_input=None,
            host_response="Host fixed r1.",
            manual_round_token="e5f6a7b8",
        )
        assert prompt.startswith("Primary agent response to your previous feedback:\n")
        assert "Round:" not in prompt
        assert "Host fixed r1." in prompt
        assert "manual_review_token to exactly e5f6a7b8" in prompt
        assert "You are reviewing" not in prompt
        assert "quadruple-backtick" not in prompt
        assert "verdict:" not in prompt


class TestMainInputValidation:
    def test_user_relay_round_emits_prompt_without_loading_an_adapter(
        self, monkeypatch, capsys
    ):
        monkeypatch.setattr(
            sys,
            "argv",
            [
                "agent_review.py",
                "--agent",
                "manual",
                "--iteration",
                "1",
            ],
        )
        monkeypatch.setattr(
            "agent_review.get_agent",
            lambda _name: pytest.fail("user relay must not load an adapter"),
        )
        monkeypatch.setattr(
            "agent_review.request_review",
            lambda *args, **kwargs: pytest.fail(
                "user relay must not invoke a reviewer"
            ),
        )
        monkeypatch.setattr("agent_review.secrets.token_hex", lambda _size: "a1b2c3d4")
        monkeypatch.setattr("sys.stdin.read", lambda: "Review src/auth.py")

        assert main() == 0
        output = capsys.readouterr().out
        assert "Review src/auth.py" in output
        assert "exactly one quadruple-backtick code fence" in output
        assert "manual_review_token: exactly a1b2c3d4" in output

    def test_user_relay_later_round_does_not_require_session_id(
        self, monkeypatch, capsys
    ):
        monkeypatch.setattr(
            sys,
            "argv",
            [
                "agent_review.py",
                "--agent",
                "manual",
                "--iteration",
                "2",
            ],
        )
        monkeypatch.setattr("agent_review.secrets.token_hex", lambda _size: "e5f6a7b8")
        monkeypatch.setattr("sys.stdin.read", lambda: "Rejected: r1 is mistaken.")

        assert main() == 0
        output = capsys.readouterr().out
        assert "Primary agent response to your previous feedback:" in output
        assert "Rejected: r1 is mistaken." in output
        assert "No new review input" not in output
        assert "manual_review_token to exactly e5f6a7b8" in output
        assert "You are reviewing" not in output
        assert "verdict:" not in output

    def test_iteration_can_exceed_default_soft_budget(self, monkeypatch, capsys):
        monkeypatch.setattr(
            sys,
            "argv",
            ["agent_review.py", "--agent", "manual", "--iteration", "11"],
        )
        monkeypatch.setattr("agent_review.secrets.token_hex", lambda _size: "a1b2c3d4")
        monkeypatch.setattr("sys.stdin.read", lambda: "Accepted: fixed the issue.")

        assert main() == 0
        assert "Accepted: fixed the issue." in capsys.readouterr().out

    def test_explicit_iteration_limit_remains_hard(self, monkeypatch, capsys):
        monkeypatch.setattr(
            sys,
            "argv",
            [
                "agent_review.py",
                "--agent",
                "manual",
                "--iteration",
                "11",
                "--max-iterations",
                "10",
            ],
        )

        assert main() == 1
        assert "--iteration cannot exceed --max-iterations" in capsys.readouterr().out

    @pytest.mark.parametrize(
        ("option", "value"),
        [
            ("--resume-session-id", "sid-1"),
            ("--add-dir", "/tmp"),
            ("--model", "model-name"),
            ("--reasoning", "high"),
            ("--timeout-seconds", "30"),
        ],
    )
    def test_user_relay_rejects_cli_only_options(
        self, monkeypatch, capsys, option, value
    ):
        monkeypatch.setattr(
            sys,
            "argv",
            [
                "agent_review.py",
                "--agent",
                "manual",
                "--iteration",
                "1",
                "--max-iterations",
                "10",
                option,
                value,
            ],
        )

        assert main() == 1
        output = capsys.readouterr().out
        assert '"reason": "invalid_input"' in output
        assert option in output

    def test_later_round_with_marker_splits_new_input_and_response(
        self, monkeypatch
    ):
        captured = {}

        def fake_request_review(
            agent,
            prompt,
            timeout_seconds,
            resume_session_id,
            add_dirs,
            model=None,
            reasoning=None,
        ):
            captured["prompt"] = prompt
            captured["timeout_seconds"] = timeout_seconds
            return {
                **_valid_payload(),
                "session_id": "sid-1",
                "resume_command": "fake resume sid-1",
                "resume_cwd": os.getcwd(),
            }

        monkeypatch.setattr(
            sys,
            "argv",
            [
                "agent_review.py",
                "--agent",
                "fake",
                "--iteration",
                "2",
                "--max-iterations",
                "10",
                "--resume-session-id",
                "sid-1",
            ],
        )
        monkeypatch.setattr("agent_review.get_agent", lambda _name: _SuccessAgent())
        monkeypatch.setattr("agent_review.request_review", fake_request_review)
        monkeypatch.setattr(
            "sys.stdin.read",
            lambda: (
                "Now also review src/db.py.\n"
                f"{HOST_RESPONSE_MARKER}\n"
                "Accepted: fixed r1."
            ),
        )

        assert main() == 0
        assert "New review input:" in captured["prompt"]
        assert "Now also review src/db.py." in captured["prompt"]
        assert "Primary agent response to your previous feedback:" in captured["prompt"]
        assert "Accepted: fixed r1." in captured["prompt"]
        assert "You are reviewing" not in captured["prompt"]
        assert "verdict:" not in captured["prompt"]

    def test_later_round_without_marker_treats_stdin_as_response(
        self, monkeypatch
    ):
        captured = {}

        def fake_request_review(
            agent,
            prompt,
            timeout_seconds,
            resume_session_id,
            add_dirs,
            model=None,
            reasoning=None,
        ):
            captured["prompt"] = prompt
            captured["timeout_seconds"] = timeout_seconds
            return {
                **_valid_payload(),
                "session_id": "sid-1",
                "resume_command": "fake resume sid-1",
                "resume_cwd": os.getcwd(),
            }

        monkeypatch.setattr(
            sys,
            "argv",
            [
                "agent_review.py",
                "--agent",
                "fake",
                "--iteration",
                "2",
                "--max-iterations",
                "10",
                "--resume-session-id",
                "sid-1",
            ],
        )
        monkeypatch.setattr("agent_review.get_agent", lambda _name: _SuccessAgent())
        monkeypatch.setattr("agent_review.request_review", fake_request_review)
        monkeypatch.setattr("sys.stdin.read", lambda: "Accepted: fixed r1.")

        assert main() == 0
        assert "Primary agent response to your previous feedback:" in captured["prompt"]
        assert "Accepted: fixed r1." in captured["prompt"]
        assert "Review input:" not in captured["prompt"]
        assert "You are reviewing" not in captured["prompt"]
        assert "verdict:" not in captured["prompt"]
        assert captured["timeout_seconds"] == 600

    def test_iteration_one_rejects_response_only_payload(
        self, monkeypatch, capsys
    ):
        monkeypatch.setattr(
            sys,
            "argv",
            [
                "agent_review.py",
                "--agent",
                "fake",
                "--iteration",
                "1",
                "--max-iterations",
                "10",
            ],
        )
        monkeypatch.setattr("agent_review.get_agent", lambda _name: _SuccessAgent())
        monkeypatch.setattr("sys.stdin.read", lambda: f"{HOST_RESPONSE_MARKER}\nAccepted.")

        exit_code = main()

        assert exit_code == 1
        captured = capsys.readouterr()
        assert '"kind": "operational_error"' in captured.out
        assert '"reason": "invalid_input"' in captured.out
        assert "iteration 1 accepts only review input" in captured.out

    def test_iteration_one_rejects_split_payload(self, monkeypatch, capsys):
        monkeypatch.setattr(
            sys,
            "argv",
            [
                "agent_review.py",
                "--agent",
                "fake",
                "--iteration",
                "1",
                "--max-iterations",
                "10",
            ],
        )
        monkeypatch.setattr("agent_review.get_agent", lambda _name: _SuccessAgent())
        monkeypatch.setattr(
            "sys.stdin.read",
            lambda: f"Review src/auth.py\n{HOST_RESPONSE_MARKER}\nAccepted.",
        )

        exit_code = main()

        assert exit_code == 1
        captured = capsys.readouterr()
        assert '"kind": "operational_error"' in captured.out
        assert '"reason": "invalid_input"' in captured.out
        assert "iteration 1 accepts only review input" in captured.out


def _valid_payload():
    return {
        "verdict": "approve",
        "issues": [],
        "open_questions": [],
        "loop_signal": False,
        "approval_reason": "looks good",
    }


class TestLooksLikeReviewPayload:
    def test_all_keys_present(self):
        assert looks_like_review_payload(_valid_payload()) is True

    def test_missing_key(self):
        payload = _valid_payload()
        del payload["loop_signal"]
        assert looks_like_review_payload(payload) is False

    def test_not_a_dict(self):
        assert looks_like_review_payload([]) is False
        assert looks_like_review_payload("x") is False


class TestNormalizeReview:
    def test_approve_without_issues(self):
        result = normalize_review(_valid_payload())
        assert result["verdict"] == "approve"
        assert result["issues"] == []
        assert result["loop_signal"] is False
        assert "session_id" not in result

    def test_with_valid_issue(self):
        payload = _valid_payload()
        payload["verdict"] = "needs_changes"
        payload["issues"] = [
            {
                "id": "i1",
                "title": "Missing retry",
                "severity": "high",
                "recommendation": "Add retry",
                "rationale": "Network ops fail",
            }
        ]
        result = normalize_review(payload)
        assert len(result["issues"]) == 1
        assert result["issues"][0]["id"] == "i1"
        assert result["issues"][0]["severity"] == "high"

    def test_missing_key_rejected(self):
        payload = _valid_payload()
        del payload["open_questions"]
        with pytest.raises(ValueError, match="does not match"):
            normalize_review(payload)

    def test_invalid_verdict(self):
        payload = _valid_payload()
        payload["verdict"] = "maybe"
        with pytest.raises(ValueError, match="Unsupported verdict"):
            normalize_review(payload)

    def test_issue_with_bad_severity(self):
        payload = _valid_payload()
        payload["issues"] = [
            {
                "id": "x",
                "title": "t",
                "severity": "critical",
                "recommendation": "r",
                "rationale": "why",
            }
        ]
        with pytest.raises(ValueError, match="severity"):
            normalize_review(payload)

    def test_issue_with_empty_field(self):
        payload = _valid_payload()
        payload["issues"] = [
            {
                "id": "",
                "title": "t",
                "severity": "low",
                "recommendation": "r",
                "rationale": "why",
            }
        ]
        with pytest.raises(ValueError, match="empty"):
            normalize_review(payload)

    def test_loop_signal_must_be_bool(self):
        payload = _valid_payload()
        payload["loop_signal"] = "false"
        with pytest.raises(ValueError, match="loop_signal"):
            normalize_review(payload)

    def test_open_questions_must_be_strings(self):
        payload = _valid_payload()
        payload["open_questions"] = [123]
        with pytest.raises(ValueError, match="open_questions"):
            normalize_review(payload)

    def test_open_questions_strings_are_stripped_and_filtered(self):
        payload = _valid_payload()
        payload["open_questions"] = ["  one  ", "", "two"]
        result = normalize_review(payload)
        assert result["open_questions"] == ["one", "two"]


class TestBuildRepairPrompt:
    def test_includes_error(self):
        out = build_repair_prompt("bad verdict")
        assert "bad verdict" in out
        assert "exactly one bare JSON object" in out


class TestDescribeSchema:
    def test_lists_all_issue_fields(self):
        out = describe_schema()
        for key in ISSUE_KEYS:
            assert key in out

    def test_embedded_in_prompt(self):
        prompt = build_prompt(
            iteration=1, review_input="x", host_response=None
        )
        assert "verdict:" in prompt
        assert "approval_reason:" in prompt


class _StreamFailureAgent:
    """Fake adapter that exits 0 but reports a failure in its stream."""

    name = "fake"

    def __init__(self):
        self.payload_calls = 0

    def build_command(self, *, schema, resume_session_id, add_dirs, model, reasoning):
        return AgentInvocation(["true"])

    def extract_session_id(self, stdout):
        return "sid-1"

    def extract_payload(self, stdout):
        self.payload_calls += 1
        raise AgentStreamError("401 Unauthorized")

    def resume_command(self, session_id):
        return f"fake resume {session_id}"

    def classify_failure(self, completed):
        return OperationalError("auth_unavailable", "401 Unauthorized")


class _SuccessAgent:
    """Fake adapter that returns a valid payload and a resumable session id."""

    name = "fake"

    def build_command(self, *, schema, resume_session_id, add_dirs, model, reasoning):
        return AgentInvocation(["true"])

    def extract_session_id(self, stdout):
        return "sid-42"

    def extract_payload(self, stdout):
        return _valid_payload()

    def resume_command(self, session_id):
        return f"fake resume {session_id}"

    def classify_failure(self, completed):
        return OperationalError("agent_cli_failed", "unused")


class TestRequestReviewResumeCommand:
    def test_session_id_and_resume_command_surfaced(self, monkeypatch):
        agent = _SuccessAgent()

        def fake_run(argv, **kwargs):
            import subprocess

            return subprocess.CompletedProcess(
                args=argv, returncode=0, stdout="ignored", stderr=""
            )

        monkeypatch.setattr("agent_review.subprocess.run", fake_run)

        result = request_review(
            agent,
            prompt="p",
            timeout_seconds=30,
            resume_session_id=None,
            add_dirs=[],
        )

        assert result["session_id"] == "sid-42"
        assert result["resume_command"] == "fake resume sid-42"
        assert result["resume_cwd"] == os.getcwd()


class TestRequestReviewStreamFailure:
    def test_stream_failure_routes_through_classify_without_retry(self, monkeypatch):
        agent = _StreamFailureAgent()

        def fake_run(argv, **kwargs):
            import subprocess

            return subprocess.CompletedProcess(
                args=argv, returncode=0, stdout="ignored", stderr=""
            )

        monkeypatch.setattr("agent_review.subprocess.run", fake_run)

        with pytest.raises(OperationalError) as excinfo:
            request_review(
                agent,
                prompt="p",
                timeout_seconds=30,
                resume_session_id=None,
                add_dirs=[],
            )

        assert excinfo.value.reason == "auth_unavailable"
        # No repair retry: extract_payload is called exactly once.
        assert agent.payload_calls == 1
