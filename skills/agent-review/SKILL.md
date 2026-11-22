---
name: agent-review
description: Run a peer CLI agent (Claude Code, Codex, OpenCode, pi), or prepare a reviewer handoff via user relay, to review code, diffs, or plans, including a plan through its implementation and commits, when explicitly requested by the user or via $agent-review.
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
When an earlier review already covered part of the subject, choose whether to review the whole subject or only the part that review did not cover, such as the commits after the one it reviewed, unless the user said which.
State the choice to the user with the subject.

State the subject and compose the review focus according to [Review focus](review-focus.md).
If the subject is a plan that you will implement yourself, also follow [Plan and implementation](plan-and-implementation.md).

For repository changes reviewed via CLI, instruct the reviewer to run the exact diff command rather than pasting a captured diff.
When the reviewer runs a diff command for a working-tree review, also instruct it to run `git status --short` and inspect every in-scope change that the diff command does not show, such as an untracked file or, under `git diff`, a change added to the index.
Leave finding these changes to the reviewer; do not list the files that contain them.
When the working tree contains changes outside the subject, state the subject's boundary instead, such as its paths.

Use path-based input for project files that the reviewer can access.
Materialize larger non-repository subjects in `/tmp` only when the selected review path can access that file.

## Meta-review

If the user asks for feedback on this skill or on how a review went, rather than on the reviewed artifact, also read [Meta-review](meta-review.md).
