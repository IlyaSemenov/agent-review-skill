# Review via CLI

This path runs a supported reviewer through the pinned `acpx` client.

## Confirm reviewer trust

Before the first CLI round, tell the user that the selected reviewer receives the review input and that `acpx` auto-approves all of its local tool permission requests.
Explain that the reviewer can therefore execute commands and modify project files even though the review prompt explicitly prohibits changes.

Obtain the user's explicit confirmation once for the review session.
When host-specific guidance also requires authorization for outbound project data, combine both grants into one confirmation.

## Configure the reviewer

Pass the selected reviewer as `--agent <identifier>` on every round.
Keep the same reviewer throughout one review because each `session_id` names one persistent `acpx` session.

Pass `--model` only when the user explicitly requested a specific model, and pass `--reasoning` only when the user explicitly requested a reasoning level.
Never select, infer, or discover either value on the user's behalf; when a value was not requested, omit its flag so the reviewer CLI uses its configured default.
Forward requested values unchanged and pass them again on every resume round.

The helper discovers the selected reviewer's ACP reasoning option and validates its available values.
When `SKILL.md` links a reviewer-specific runtime document, follow it for value syntax and capability limits.

## Run round 1

Keep the shell working directory in the repository being reviewed.
Resolve `SKILL_DIR` to the directory containing `SKILL.md` and invoke the helper by absolute path.

```bash
cat <<'EOF' | node "$SKILL_DIR/scripts/agent_review.ts" \
  --agent claude \
  --iteration 1
Review docs/plan.md and src/reviewer.py. Focus on missing decisions and retry behavior.
EOF
```

Round-1 stdin is the review subject.
The helper sends the full reviewer role, rules, subject, and response contract.

## Resume later rounds

Pass the previous output's `session_id` through `--resume-session-id`.
Send only the host response to prior feedback unless the reviewer also needs new scope.

```bash
cat <<'EOF' | node "$SKILL_DIR/scripts/agent_review.ts" \
  --agent claude \
  --iteration 2 \
  --resume-session-id "$SESSION_ID"
Accepted: added retry-with-backoff to publish().
Rejected: the caller already holds the lock, so the proposed mutex is redundant.
EOF
```

The helper sends a delta-only follow-up and does not repeat the role, original subject, schema, or unchanged guidance.
If the session is lost, start a new review instead of reconstructing it from pasted history.

Keep referenced review files under the review working directory because the `acpx` CLI transport does not expose additional readable-directory roots.

## Timeouts and operational errors

The helper gives the entire round, including a possible JSON-repair retry, a 900-second wall-clock budget by default.
Use `--timeout-seconds` only when the user explicitly requested a different real review budget.

If a sandboxed launch returns `auth_unavailable`, rerun the same helper command with the required escalation before diagnosing reviewer authentication.
If it returns `dependency_unavailable`, allow `npx` network access and rerun the same command.
If a background launch returns a false timeout, rerun the same command in the foreground before changing the helper timeout.

Stop the review loop when the helper returns `kind: operational_error`.
Report its reason and message instead of treating it as review feedback.
When its reason is `timeout`, do not retry with a larger budget; let the user decide whether to diagnose the reviewer or start another review.

## Output contract

The helper prints normalized JSON with this shape:

```json
{
  "session_id": "...",
  "verdict": "approve",
  "issues": [],
  "open_questions": [],
  "loop_signal": false,
  "approval_reason": "..."
}
```

Use `session_id` for the next helper invocation.
