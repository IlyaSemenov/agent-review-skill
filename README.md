# agent-review

A skill that brings in a second coding agent to review your work — a plan, some code, a diff, or a design note — so you get a second opinion without leaving your current agent.

It can run the reviewer directly or prepare a prompt that the user relays to a reviewer.
Currently supported CLI reviewers:

- Claude Code (`claude`)
- Codex (`codex`)
- OpenCode (`opencode`)
- pi (`pi`)

You use it from any agent that supports skills (e.g. Claude, Codex, OpenCode, pi.dev, …). It adds `$agent-review`: you point it at a concrete subject, it runs the chosen reviewer on it, and your agent stays responsible for deciding what to accept, what to reject, and whether another round is worth doing.

## Install

```bash
npx skills add -g https://github.com/IlyaSemenov/agent-review-skill
```

## Usage

For review via CLI, ask your agent to use `$agent-review` and name one of the supported reviewers above, e.g. "review with Codex".
The skill asks which CLI reviewer to use if you omit it.

```text
Use $agent-review with claude on this plan.
```

```text
Use $agent-review with codex to review the changes in src/reviewer.py and tell me which objections you agree with.
```

The same reviewer is used for every round of a review; a session belongs to one agent, so the loop does not switch agents midway.

You can optionally ask for a specific model or reasoning level, such as "review with codex on gpt-5.5, high reasoning".
Requested values are forwarded through ACP, while omitted values are left to the reviewer's configured defaults.
OpenCode currently supports model selection but not an explicit reasoning level through ACP.

To review via user relay, ask for `user relay` instead of naming a CLI reviewer.
The host agent gives you a prompt to send to any reviewer and accepts the pasted feedback with or without JSON.

When pasted review JSON is surrounded by extra text, the host treats that text as your own comment.
Each round asks the reviewer to echo a token inside JSON to help catch an accidentally pasted response from another round or review.

```text
Use $agent-review with user relay to review this plan.
```

## Requirements

- Node.js 22.18 or newer
- `npx` on your `PATH`
- macOS or Linux for review via CLI
- network access on the first CLI review so `npx` can fetch the exact `acpx` client and the selected ACP adapter
- authentication for the selected reviewer in its normal local environment

## How It Works

The [review helper](skills/agent-review/scripts/agent_review.ts) is a thin executable entrypoint for an agent-agnostic TypeScript orchestrator executed directly by Node.js.
Its implementation separates the review contract, ACP transport, and CLI composition in [`scripts/agent_review/`](skills/agent-review/scripts/agent_review/).
It runs one review round per invocation; the calling agent drives the loop.

For CLI review, it launches the pinned `acpx` client through `npx` and uses a persistent named ACP session.
With `--agent manual`, the same orchestrator builds the reviewer prompt without launching another process.

Each invocation:

- builds reviewer instructions for a concrete subject
- invokes the selected reviewer and returns structured feedback plus an `acpx` session name when reviewing via CLI
- prints a prompt for the user to relay when reviewing via user relay

Between rounds, the calling agent:

- inspects the feedback and decides what to accept, what to reject, and what to defend
- continues the same reviewer conversation through CLI resume or user relay
- sends only the round delta rather than repeating the role, original subject, or response schema
- repeats only while another round is still likely to improve the review or clarify a real disagreement
- treats 10 rounds as a soft budget unless you explicitly request a hard limit
- refreshes that soft budget when you materially change the requirements or review scope
- stops when the agent approves or when the remaining disagreement is clear enough that another round is not worth it
- after each round, reports every issue before investigating or editing, then reports its decision and intended change before applying accepted feedback
- at the end, reports back to the user a final summary of all issues raised across rounds, grouped into what was fixed, what was rejected and dropped, and what remains unresolved for the user to judge

When the review refers to existing project files, the host points the reviewer at those files directly.

When the review subject is large but not already materialized as a project file, the skill can place it in a temporary file and run the helper from that file's directory.

## Notes

- The skill is explicit-only.
  It should run when you ask for it, not implicitly.
- The first CLI review may take longer while `npx` downloads and caches `acpx` and the selected ACP adapter.
- The `acpx` client and every reviewer adapter are pinned to exact versions.
- In sandboxed environments, the reviewer's login may be unavailable even when it works in your normal shell.
  In that case, the agent may need to rerun the helper with escalation.
- The skill treats every CLI reviewer as a user-selected trusted local agent.
  Reviewers run noninteractively through ACP with every local tool permission request approved, so they can execute commands and modify project files.
  The review-only prompt is a behavioral contract rather than a uniform security boundary.
- The helper defaults to a 600-second timeout for larger reviews.

## Development

Install the pinned tools and dependencies:

```bash
mise install
bun install
```

Run the development checks:

```bash
bun run types
bun run lint
bun test
```
