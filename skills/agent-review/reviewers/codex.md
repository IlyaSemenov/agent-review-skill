# Review with Codex

When Codex reports that a model requires a newer CLI, check the executable selected by `CODEX_PATH`, or the adapter's bundled `@openai/codex` package if the variable is unset.
Updating the system Codex CLI does not update the bundled package.

If the user requests a separately installed Codex CLI, set `CODEX_PATH` to its absolute executable path for every round.
Resolve the path before launching the helper: `npx` prepends package executables to `PATH`, so a bare `codex` value can select the bundled CLI.
