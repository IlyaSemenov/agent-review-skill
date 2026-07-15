# agent-review

A skill that brings in a second coding agent to review your work — a plan, some code, a diff, or a design note — so you get a second opinion without leaving your current agent.

It can run the reviewer through that agent's own command-line tool or prepare a prompt that the user relays to a reviewer.
Currently supported CLI reviewers:

- Claude Code (`claude`)
- Codex (`codex`)
- OpenCode (`opencode`)

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

The same reviewer is used for every round of a review; a session belongs to one agent, so the loop does not switch agents midway. You can optionally ask for a specific model or reasoning level (e.g. "review with codex on gpt-5.5, high reasoning") — both are optional and forwarded to that agent's CLI.

To review via user relay, ask for `user relay` instead of naming a CLI reviewer.
The host agent gives you a prompt to send to any reviewer and accepts the pasted feedback with or without JSON.
When pasted review JSON is surrounded by extra text, the host treats that text as your own comment.
Each round asks the reviewer to echo a token inside JSON to help catch an accidentally pasted response from another round or review.

```text
Use $agent-review with user relay to review this plan.
```

## Requirements

- `python3` on your `PATH`
- for review via CLI, the chosen reviewer's CLI on your `PATH` and already authenticated

## How It Works

The [review helper](skills/agent-review/scripts/agent_review.py) is an agent-agnostic orchestrator.
It runs one review round per invocation; the calling agent drives the loop.
The CLI-specific details (how to invoke the agent, how to read its output, how to classify failures) live in the [adapter modules](skills/agent-review/scripts/adapters/).
With `--agent manual`, the same orchestrator builds the reviewer prompt without loading an adapter or launching another process.

Each invocation:

- builds reviewer instructions for a concrete subject
- invokes the selected reviewer and returns structured feedback plus a `session_id` when reviewing via CLI
- prints a prompt for the user to relay when reviewing via user relay

Between rounds, the calling agent:

- inspects the feedback and decides what to accept, what to reject, and what to defend
- continues the same reviewer conversation through CLI resume or user relay
- sends only the round delta rather than repeating the role, original subject, or response schema
- repeats only while another round is still likely to improve the review or clarify a real disagreement
- treats 10 rounds as a soft budget unless you explicitly request a hard limit
- refreshes that soft budget when you materially change the requirements or review scope
- stops when the agent approves or when the remaining disagreement is clear enough that another round is not worth it
- after each round, prints a one-line-per-issue progress update (what was raised and whether it was accepted or rejected)
- at the end, reports back to the user a final summary of all issues raised across rounds, grouped into what was fixed, what was rejected and dropped, and what remains unresolved for the user to judge

When the review refers to existing project files, the host points the reviewer at those files directly.
When the review subject is large but not already materialized as a project file, the skill can place it in a temporary file and review that path instead.

## Notes

- The skill is explicit-only. It should run when you ask for it, not implicitly.
- In sandboxed environments, the reviewer's login may be unavailable even when the CLI works in your normal shell. In that case, the agent may need to rerun the helper with escalation.
- The helper defaults to a 600-second timeout for larger reviews.

## Development

Tests for the helper's pure functions and the adapters live in the [test suite](skills/agent-review/tests/) and use pytest.

Run them with `uv` (no setup — pytest is fetched on demand):

```bash
cd skills/agent-review
uv run --with pytest python -m pytest tests/
```

Or, if you already have pytest in your environment:

```bash
cd skills/agent-review
python3 -m pytest tests/
```
