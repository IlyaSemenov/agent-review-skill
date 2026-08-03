# Review via CLI

This path runs a supported reviewer through its CLI.

## Configure the reviewer

Pass the selected reviewer as `--agent <identifier>` on every round.
Keep the same reviewer throughout one review because session ids are CLI-specific.

Pass `--model` only when the user explicitly requested a specific model, and pass `--reasoning` only when the user explicitly requested a reasoning level.
Never select, infer, or discover either value on the user's behalf; when a value was not requested, omit its flag so the reviewer CLI uses its configured default.
Forward requested values unchanged and pass them again on every resume round.
Let the selected CLI validate its accepted model and reasoning values.
When `SKILL.md` links a reviewer-specific runtime document, follow it for value syntax and capability limits.

## Run round 1

Keep the shell working directory in the repository being reviewed.
Resolve `SKILL_DIR` to the directory containing `SKILL.md` and invoke the helper by absolute path.

```bash
cat <<'EOF' | python3 "$SKILL_DIR/scripts/agent_review.py" \
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
cat <<'EOF' | python3 "$SKILL_DIR/scripts/agent_review.py" \
  --agent claude \
  --iteration 2 \
  --resume-session-id "$SESSION_ID"
Accepted: added retry-with-backoff to publish().
Rejected: the caller already holds the lock, so the proposed mutex is redundant.
EOF
```

The helper sends a delta-only follow-up and does not repeat the role, original subject, schema, or unchanged guidance.
If the session is lost, start a new review instead of reconstructing it from pasted history.

Use `--add-dir` once per extra readable directory referenced by stdin unless the selected reviewer's runtime document forbids it.

## Timeouts and operational errors

The helper gives the entire round, including a possible JSON-repair retry, a 600-second wall-clock budget by default.
Use `--timeout-seconds` only to change the real review budget.

If a sandboxed launch returns `auth_unavailable`, rerun the same helper command with the required escalation before diagnosing reviewer authentication.
If a background launch returns a false timeout, rerun the same command in the foreground before changing the helper timeout.

Stop the review loop when the helper returns `kind: operational_error`.
Report its reason and message instead of treating it as review feedback.

## Output contract

The helper prints normalized JSON with this shape:

```json
{
  "session_id": "...",
  "resume_command": "...",
  "resume_cwd": "...",
  "verdict": "approve",
  "issues": [],
  "open_questions": [],
  "loop_signal": false,
  "approval_reason": "..."
}
```

Use `session_id` for the next helper invocation.
Preserve `resume_command` and `resume_cwd` for the final report.
