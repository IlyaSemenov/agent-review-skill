# Agent Review Development

You are developing the `agent-review` skill in `skills/agent-review/`, not running a review as its host or reviewer.

## How a review runs

One review is a sequence of rounds controlled by the host agent:

1. The user asks a host agent to obtain a peer review.
2. The host identifies the review subject and selects whether the review runs via CLI or user relay according to `skills/agent-review/SKILL.md`.
3. The reviewer receives the full subject and review instructions in the first round.
4. The reviewer returns feedback to the host through a CLI or through the user relay.
5. The host judges the feedback and changes the reviewed artifact when appropriate.
6. If another round is useful, the same reviewer conversation receives only the host's response, relevant changes, and any new scope.
7. The host stops when further review is not useful and reports the outcome to the user.

`scripts/agent_review.py` implements one round of this process.
In this documentation, **core** means its CLI-independent behavior, while an **adapter** contains behavior specific to one reviewer CLI.

Use these role names consistently while editing the skill:

- **Developer agent** — the agent modifying this repository.
- **Host agent** — the agent executing the installed skill for a user.
- **Reviewer agent** — the peer agent evaluating the host agent's artifact.
- **User** — the person directing the host and, when review runs via user relay, carrying messages between sessions.

Keep developer instructions in this file and its linked development documents.
Keep runtime instructions for the host agent in `skills/agent-review/SKILL.md` and its linked runtime documents.
Do not place instructions addressed to a running host or reviewer in developer documentation.

## Where to make changes

Classify the requested change by where it acts in the review flow, then read the matching document before editing:

- Changes to helper input, prompt construction shared by both review paths, round behavior, response fields, normalization, retries, timeout, or helper output: read [Core development](docs/development/core.md).
- Changes to `--agent manual`, user relay, relay prompts, or lenient interpretation of pasted reviewer responses: read both [User-relay development](docs/development/user-relay.md) and [Core development](docs/development/core.md).
- Changes to how a named reviewer CLI is invoked, resumed, parsed, registered, or diagnosed: read [Adapter development](docs/development/adapters.md).
- Changes to instructions followed by a host running the installed skill: edit the matching runtime document selected by `skills/agent-review/SKILL.md` and read the development document for the behavior being documented.

Read every listed document when a task spans multiple areas.

## Commands

```bash
cd skills/agent-review
uv run --with pytest python -m pytest tests/ -v
```

## Documentation rules

- Keep the concrete reviewer list only in `skills/agent-review/SKILL.md` and `README.md`.
- Keep guidance for review via CLI, review via user relay, and specific host environments in separate documents next to `SKILL.md`.
- Keep `SKILL.md` as the runtime router and move detailed instructions into its linked runtime documents.
- Write project names in prose as Claude Code, Codex, and OpenCode; use lowercase only for CLI commands and `--agent` identifiers.
- Use `…` only for genuinely open sets, not for the concrete reviewer list.
