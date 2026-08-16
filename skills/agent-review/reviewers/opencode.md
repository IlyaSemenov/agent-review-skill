# Review with OpenCode

Apply these rules only when the selected reviewer is OpenCode.

OpenCode expects model values in `provider/model` form.
Pass an explicitly requested model unchanged and let OpenCode validate it.

OpenCode's ACP server does not expose a reasoning-level configuration option.
Do not pass `--reasoning` with `--agent opencode`.
