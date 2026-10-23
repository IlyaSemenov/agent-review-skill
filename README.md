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
Requested values are forwarded to the reviewer's own CLI options, while omitted values are left to the reviewer's configured defaults.
For OpenCode, the reasoning level is passed as the model variant.

To review via user relay, ask for `user relay` instead of naming a CLI reviewer.
The host agent gives you a prompt to send to any reviewer and accepts the pasted feedback with or without JSON.

When pasted review JSON is surrounded by extra text, the host treats that text as your own comment.
Each round asks the reviewer to echo a token inside JSON to help catch an accidentally pasted response from another round or review.

```text
Use $agent-review with user relay to review this plan.
```

When the reviewed plan is one your agent will implement, the review continues through the implementation: the same reviewer checks each implemented part, and the agent commits it.
The agent stops between parts, after each part's commit, and after the plan review when a disagreement with the reviewer remains unresolved.
Say "YOLO" to skip these stops; the agent still stops for decisions only you can make.

```text
Plan this feature, review the plan with $agent-review and codex, then implement it. YOLO.
```

## Requirements

- Node.js 22.18 or newer
- `npm` on your `PATH`
- the selected reviewer's CLI (`claude`, `codex`, `opencode`, or `pi`) installed and on your `PATH`
- macOS or Linux for review via CLI
- on Linux, `bubblewrap` and `socat` for the Claude Code reviewer's sandbox
- network access on the first CLI review so the helper can install its runtime dependencies
- authentication for the selected reviewer in its normal local environment

## Allow the helper in auto-approval modes

In auto-approval modes, such as Codex auto review or Claude Code auto mode, the host's classifier may block the helper because it sends project context to another agent.
The host then asks you to confirm the review session.
To prevent the block, allow the helper command once per host and machine by sending this prompt to the host agent:

```text
Allow the agent-review skill helper to run without approval prompts.
Find the agent-review skill directory you load skills from (the one containing SKILL.md); if it is a symlink, keep the unresolved path.
Let HELPER be the absolute path of scripts/agent_review.ts in that directory.
- If you are Claude Code: add "Bash(node HELPER *)" to permissions.allow in ~/.claude/settings.json, keeping existing entries. Write HELPER as it appears in a shell command, quoted only if it contains characters that require shell quoting.
- If you are Codex: append prefix_rule(pattern=["node", "HELPER"], decision="allow") to ~/.codex/rules/default.rules, with HELPER as the plain path without shell quotes, and tell me to restart Codex.
Show me the exact entry you added.
```

The rule lets any session of that host start a review without a harness block, including sending review input to the reviewer.
OpenCode and pi reviewers still need your confirmation once per review session because they run with every local tool permission approved.
In Codex, it also runs the helper outside the sandbox, which the reviewer CLI needs.
Reinstalling the skill at another path requires a new rule.

## Review method

The reviewer applies the [review method](skills/agent-review/review-method.md) of [top-down-review](https://github.com/IlyaSemenov/top-down-review-skill): it checks the purpose and product contract of the change first, then the solution the task needs, and only then the implementation.
The skill carries its own copy of the method, so you do not need to install top-down-review.

Install top-down-review when you also want a quick single-pass review by your current agent, with a report grouped by WHY, WHAT, and HOW.

## How It Works

The [review helper](skills/agent-review/scripts/agent_review.ts) is a thin executable entrypoint for an agent-agnostic TypeScript orchestrator executed directly by Node.js.
Its implementation separates the review contract, reviewer transport, runtime dependency installation, and CLI composition in [`scripts/agent_review/`](skills/agent-review/scripts/agent_review/).
It runs one review round per invocation; the calling agent drives the loop.

For CLI review, it drives the reviewer's native CLI through [`@agentex/agent`](https://github.com/dynamismlabs/agentex/tree/main/packages/agent) and continues the reviewer's own session in later rounds.
With `--agent manual`, the same orchestrator builds the reviewer prompt without launching another process.

Each invocation:

- builds reviewer instructions for the subject and a request-specific focus composed by the calling agent
- invokes the selected reviewer and returns structured feedback plus the reviewer's session id when reviewing via CLI
- prints a prompt for the user to relay when reviewing via user relay

Between rounds, the calling agent:

- inspects the feedback and decides what to accept, what to reject, and what to defend
- continues the same reviewer conversation through CLI resume or user relay
- sends only the round delta rather than repeating the role, original subject, or response schema
- repeats only while another round is still likely to improve the review or clarify a real disagreement
- treats 10 rounds as a soft budget
- refreshes that soft budget when you materially change the requirements or review scope
- receives polish only for code that no pending finding is about to rewrite, and the remaining polish once those findings are settled
- stops when the agent approves or when the remaining disagreement is clear enough that another round is not worth it
- after each round, reports every issue before investigating or editing, then reports its decision and intended change before applying accepted feedback
- at the end, reports back to the user a final summary of all issues raised across rounds, grouped into what was fixed, what was rejected and dropped, and what remains unresolved for the user to judge, along with what the host and the reviewer checked and what remains unverified

When the review refers to existing project files, the host points the reviewer at those files directly.

When the review subject is large but not already materialized as a project file, the skill can place it in a temporary file and run the helper from that file's directory.

## Notes

- The skill is explicit-only.
  It should run when you ask for it, not implicitly.
- The first CLI review may take longer while the helper installs its locked runtime dependencies into `~/.cache/agent-review`.
- Runtime dependencies are pinned by a lockfile; the reviewer CLIs are the versions installed on your machine.
- In sandboxed environments, the reviewer's login may be unavailable even when it works in your normal shell.
  In that case, the agent may need to rerun the helper with escalation.
- The skill treats every CLI reviewer as a user-selected trusted local agent.
  Codex reviewers run in a read-only sandbox and cannot write any files.
  Claude Code reviewers have only read, shell, and web tools, and their shell commands run in Claude Code's sandbox, which blocks writes to the project; your own Claude Code sandbox exceptions still apply.
  OpenCode and pi reviewers run noninteractively with every local tool permission approved, so they can execute commands and modify project files; for them the review-only prompt is a behavioral contract rather than a security boundary.
- The helper gives each CLI round a 900-second wall-clock budget.

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
