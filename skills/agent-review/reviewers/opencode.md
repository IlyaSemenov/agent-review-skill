# Review with OpenCode

Apply these rules only when the selected reviewer is OpenCode.

OpenCode expects model values in `provider/model` form.
Pass an explicitly requested model unchanged and let OpenCode validate it.

OpenCode has no CLI-side response-schema enforcement.
The helper's shared prompt, validation, and repair retry enforce the review contract without host action.

OpenCode cannot read additional directories through its adapter.
Do not pass `--add-dir` when reviewing with OpenCode.
Keep review material in its working tree or select a different reviewer.
