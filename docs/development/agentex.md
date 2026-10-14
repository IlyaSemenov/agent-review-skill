# agentex development

This document records the agentex transport boundary and the workflow for changing a reviewer integration.
Keep shared orchestration rules in [Core development](core.md).

## Runtime dependencies

Keep the helper's runtime npm dependencies only in `scripts/agent_review/runtime/package.json`:

- Pin exact versions and commit the matching `package-lock.json`.
- Regenerate the lockfile with `npm install --package-lock-only --ignore-scripts` in that directory after every manifest change.
- Keep the root `devDependencies` entry for `@agentex/agent` at the same exact version; it provides types only.
- When updating all npm dependencies, include the runtime manifest.
- After changing the runtime manifest, rerun the live two-round check for every reviewer; mocked tests cannot validate native CLI compatibility.

Keep installation and loading in `scripts/agent_review/runtime.ts` until agentex provides a CLI entry point ([dynamismlabs/agentex#3](https://github.com/dynamismlabs/agentex/issues/3)):

- Install the locked dependency set with `npm ci` into `${XDG_CACHE_HOME:-~/.cache}/agent-review/<hash>`, where the hash covers the runtime manifest and lockfile.
- Install into a temporary sibling directory and rename it into place; treat an existing hash directory as a complete install.
- Never import runtime dependencies statically; load them by resolving from the hash directory.
- Count installation against the round deadline.

## Boundary

Keep `scripts/agent_review/agentex.ts` responsible for reviewer sessions, the round deadline, the parse-repair retry, reviewer permissions, and transport failure classification.
Keep reviewer-specific branches limited to configuration that agentex does not unify.
Keep host-facing rules for a named reviewer in `skills/agent-review/reviewers/<identifier>.md`.

### Sessions

- Drive every reviewer through `provider.createSession()` and `session.send()`, one session object per round, and close it after the round.
- Do not use `provider.execute()`: its pi path closes RPC stdin before pi answers.
- Use the reviewer's native session id from `session.sessionId` as the helper's `session_id` and resume it through `sessionParams: { sessionId, cwd }`.
- Keep that session identifier internal to the host review loop and do not expose a user-facing continuation command.

Fail with `session_lost` when a resumed round:

- reports a different session id, checked right after opening the session when the id is already known and again after each turn;
- reports a missing conversation;
- resumes pi from a missing or empty session file (checked before opening the session);
- gets an HTTP 404 from OpenCode.

### Deadlines

- Bound session startup by the round deadline and close a session that opens after it.
- Bound each turn by the remaining budget, rounded up to whole seconds for agentex, plus a short grace period so agentex can report its own timeout first.
- Accept a turn that completes within that grace period; do not discard a finished review.

### Model and reasoning

- Pass `--model` through `ProviderConfig.model` and `--reasoning` through the per-reviewer key in `REASONING_CONFIG_KEYS`.
- Forward both values unchanged and let the reviewer CLI validate them.

### Output and failures

- Parse the turn's `summary` with the shared JSON extractor and normalizer.
- When a failed turn has no `errorMessage`, use the captured stderr tail as its diagnostic.

### Permissions

Treat CLI reviewers as user-selected trusted local agents.
Keep network access and web search available to reviewers.
Keep each reviewer's permission configuration in `permissionConfig()` and list the reviewers with a read-only boundary in `SANDBOXED_AGENTS`:

- **Codex** — through `extraArgs`, without `skipPermissions` or `planMode`: `approval_policy="never"`, a `default_permissions` profile that extends `:read-only` with `network.enabled=true`, and `web_search="live"`.
  Do not combine the profile with `sandbox_mode`.
  Recheck writes and network live after a Codex upgrade because Codex does not document network access on top of `:read-only`.
- **Claude Code** — only `Bash,Read,Grep,Glob,WebSearch,WebFetch`, no ambient MCP servers, and a `--settings` Bash sandbox that write-protects the canonical working directory, keeps filesystem isolation enabled, fails when unavailable, and forbids unsandboxed retries.
  Fail when the working directory cannot be canonicalized.
  Settings arrays merge with the user's own Claude Code settings, so the user's `excludedCommands`, `allowWrite`, and `additionalDirectories` still apply; `$TMPDIR` stays writable.
- **OpenCode and pi** — `skipPermissions: true`; they have no read-only boundary.

Pass a denying `onUserInputRequest` to sandboxed reviewers because agentex approves every request when no handler is supplied.
Keep the generated reviewer prompt responsible for prohibiting file and repository changes for every reviewer.

Verify a permission change live on both a new and a resumed session, with write attempts:

- in the repository;
- in the home directory;
- through every remaining tool.

## Adding or changing a reviewer

Verify a reviewer with a live two-round run through the helper before encoding or changing its capability.
Cover:

- first-run installation;
- session creation and resume, including a resumed round that recalls first-round context;
- a missing session;
- authentication failures;
- model and reasoning forwarding;
- timeout behavior.

Then:

- Add the reviewer's agentex provider type to `AVAILABLE_AGENTS`, its reasoning key to `REASONING_CONFIG_KEYS`, and its permissions to `permissionConfig()`.
- Add focused cases to the test suite colocated in `scripts/agent_review/`.
- Keep the concrete reviewer list only in `skills/agent-review/SKILL.md` and `README.md`, and update both.
- Dogfood the reviewer on synthetic material after its focused tests pass.

## Upstream workarounds

Each workaround links its agentex issue at the code site.
When an issue is resolved, remove its workaround and update this list:

- [dynamismlabs/agentex#3](https://github.com/dynamismlabs/agentex/issues/3) — no CLI entry point; `runtime.ts` installs and loads the locked dependency set from the cache.
  Switch the transport to a pinned `npx -y` invocation and remove `runtime.ts`, the runtime manifest, and the cache only when the binary drives every reviewer through a working path (the requested CLI wraps `execute()`, which fails for pi per #4) and preserves the lost-session detection described in [Sessions](#sessions).
- [dynamismlabs/agentex#4](https://github.com/dynamismlabs/agentex/issues/4) — pi `execute()` returns an empty turn; `agentex.ts` drives every reviewer through `createSession()`.
- [dynamismlabs/agentex#5](https://github.com/dynamismlabs/agentex/issues/5) — a missing resumed Claude session has no `errorMessage` or dedicated error code; `agentex.ts` captures the stderr tail and classifies `session_lost` by message text.
- [dynamismlabs/agentex#6](https://github.com/dynamismlabs/agentex/issues/6) — no strict resume; `agentex.ts` compares the reported session id with the requested one after startup and after each turn, requires a non-empty pi session file before resuming, and maps an OpenCode HTTP 404 on resume to `session_lost`.
- [dynamismlabs/agentex#8](https://github.com/dynamismlabs/agentex/issues/8) — session startup is unbounded, pi `close()` does not wait or escalate, and sessions expose no pid; `agentex.ts` races session startup against the round deadline, and the entrypoint forces exit 10 seconds after printing the result.
- [dynamismlabs/agentex#9](https://github.com/dynamismlabs/agentex/issues/9) — sessions approve every permission request without a handler; `agentex.ts` passes a denying `onUserInputRequest` to sandboxed reviewers.
- [dynamismlabs/agentex#10](https://github.com/dynamismlabs/agentex/issues/10) — no first-class read-only configuration; `permissionConfig()` configures the Codex and Claude Code sandboxes through `extraArgs`.
