---
name: agent-review
description: Run a peer CLI agent (Claude Code, Codex, OpenCode), or prepare a reviewer handoff via user relay, to review code, diffs, or plans when explicitly requested by the user or via $agent-review.
argument-hint: <claude|codex|opencode|manual> [what to review]
---

# Agent Review

Use a peer agent as a reviewer, not as the authority.
Keep responsibility for deciding which feedback to accept, reject, or discuss.

## Choose the runtime branch

Act as the host agent running the skill.
The external reviewer follows the generated review prompt and does not read this skill.

- If the user explicitly requests user relay, read [Review via user relay](user-relay.md) and [Review loop](review-loop.md).
- Otherwise, read [Review via CLI](cli-review.md) and [Review loop](review-loop.md).

Load only the selected review-path document.
If neither user relay nor a CLI reviewer is named, or the choice is ambiguous, ask the user instead of guessing.

## CLI reviewers

Available review agents, by their `--agent` identifier:

- `claude` (Claude Code) — requires an authenticated `claude` on PATH.
- `codex` (Codex) — requires an authenticated `codex` on PATH.
- `opencode` (OpenCode) — requires an authenticated `opencode` on PATH.

Map a naturally named reviewer to the identifier on the left.
Pass the selected identifier, or `manual`, through the required `--agent` flag on every round.

## Identify the review subject

Review only a clearly identified subject from context, such as a diff, plan, design note, issue summary, code snippet, or project files.
In Plan Mode, use the current plan text as the subject.
If multiple targets are plausible or the request is underspecified, ask what to review.

State both the subject and the desired focus, such as missing decisions, correctness risks, scope control, code quality, or implementation gaps.
For repository changes, instruct the reviewer to run the exact diff command rather than pasting a captured diff.
Use path-based input for project files that the reviewer can access.
Materialize larger non-repository subjects in `/tmp` only when the selected review path can access that file.
