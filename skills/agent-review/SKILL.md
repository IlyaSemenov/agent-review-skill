---
name: agent-review
description: Run a peer CLI agent (Claude Code, Codex, OpenCode, pi), or prepare a reviewer handoff via user relay, to review code, diffs, or plans when explicitly requested by the user or via $agent-review.
---

# Agent Review

Use a peer agent as a reviewer, not as the authority.
Keep responsibility for deciding which feedback to accept, reject, or discuss.

## Choose the runtime branch

Act as the host agent running the skill.
The external reviewer follows the generated review prompt and does not read this skill.

- If the user explicitly requests user relay, read [Review via user relay](user-relay.md) and [Review loop](review-loop.md).
- Otherwise, read [Review via CLI](cli-review.md), [Review loop](review-loop.md), and any matching host and reviewer guidance selected below.

Load only the common documents for the selected review path and its applicable host and reviewer documents.
If neither user relay nor a CLI reviewer is named, or the choice is ambiguous, ask the user instead of guessing.

## CLI reviewers

Available review agents, by their `--agent` identifier:

- `claude` (Claude Code).
- `codex` (Codex).
- `opencode` (OpenCode) — read [OpenCode reviewer guidance](reviewers/opencode.md).
- `pi` (pi) — read [pi reviewer guidance](reviewers/pi.md).

Map a naturally named reviewer to the identifier on the left.
Pass the selected identifier, or `manual`, through the required `--agent` flag on every round.
CLI review requires Node.js 22.18 or newer, `npm`, first-run network access, the selected reviewer's CLI on `PATH`, and its authentication in the normal local environment.

## Select host guidance

When running the CLI path, also read the document matching the host environment:

- Claude Code host: read [Claude Code host guidance](hosts/claude-code.md).
- Codex host: read [Codex host guidance](hosts/codex.md).

If no host document exists, run the helper in the foreground with the required permissions.

## Identify the review subject

Review only a clearly identified subject from context, such as a diff, plan, design note, issue summary, code snippet, or project files.
In Plan Mode, use the current plan text as the subject.
If multiple targets are plausible or the request is underspecified, ask what to review.

State both the subject and the desired focus, such as missing decisions, correctness risks, scope control, code quality, or implementation gaps.

For repository changes reviewed via CLI, instruct the reviewer to run the exact diff command rather than pasting a captured diff.
For a working-tree review, also instruct the reviewer to run `git status --short` and inspect every in-scope untracked file.

Use path-based input for project files that the reviewer can access.
Materialize larger non-repository subjects in `/tmp` only when the selected review path can access that file.
