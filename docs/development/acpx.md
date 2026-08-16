# acpx development

This document records the ACP transport boundary and the workflow for changing a reviewer integration.
Keep shared orchestration rules in [Core development](core.md).

## Boundary

Keep the exact ACP client package specifier in `ACPX_PACKAGE` in `scripts/agent_review/acpx.ts`.
Keep each reviewer's exact command in `REVIEWER_COMMANDS` and pass it through the Unix-only `acpx --agent` override instead of a built-in agent alias.
Build named-session prompt invocations with the explicit `prompt` subcommand before session flags because raw `--agent` invocations do not expose those flags on the top-level command.
Recheck live adapter behavior whenever the client or an adapter pin changes.

Use a persistent named `acpx` session as the helper's `session_id` and continue it through `--resume-session-id`.
Use the same exact reviewer command for session creation, prompts, configuration, cancellation, and resume because the command is part of the `acpx` session scope key.
Treat an adapter pin change as a session-scope change; sessions created with the previous command are not resumable through the new command.
Keep that session identifier internal to the host review loop and do not expose a user-facing continuation command.

Parse the reviewer's quiet text output with the shared JSON extractor and normalizer.
Keep reviewer-specific branches limited to capability validation that ACP cannot represent uniformly.
Keep host-facing rules for a named reviewer in `skills/agent-review/reviewers/<identifier>.md`.

Treat CLI reviewers as user-selected trusted local agents.
Treat ACP permission policy as invocation policy, not as a security boundary.

Auto-approve every ACP permission request because reviewers need noninteractive shell access for inspection and agents may classify read-only shell commands as `execute` or `other`.
Do not claim a uniform read-only boundary: ACP session modes are adapter-defined, and `acpx` permission policies cannot distinguish a read-only shell command from a modifying command of the same tool kind.

Keep the generated reviewer prompt responsible for prohibiting file and repository changes.
Do not use `--auth-policy fail` unless the helper also supplies matching ACP client credentials because it rejects agents that can otherwise use their existing native authentication.

## Adding or changing a reviewer

Verify the pinned `acpx` version with a live two-round run before encoding or changing a reviewer capability.
Cover session creation and resume, quiet output, authentication and dependency failures, model forwarding, semantic `thought_level` discovery, timeout behavior, and permission behavior.
Keep model values opaque and pass them again on resume.

Discover reasoning by the ACP configuration category `thought_level` instead of hardcoding reviewer-specific option ids.
Fail with `invalid_input` when a reviewer does not expose that category or rejects the requested value.
Add focused cases to the test suite colocated in `scripts/agent_review/`.

Keep the concrete reviewer list only in `skills/agent-review/SKILL.md` and `README.md`, and update both when adding a reviewer.
Dogfood a new reviewer on synthetic material after its focused tests pass.
