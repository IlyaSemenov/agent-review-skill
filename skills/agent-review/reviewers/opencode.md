# Review with OpenCode

Apply these rules only when the selected reviewer is OpenCode.

OpenCode expects model values in `provider/model` form.
Pass an explicitly requested model unchanged and let OpenCode validate it.

The helper passes `--reasoning` to OpenCode as its model variant (`--variant`).
Variant names are provider-specific, such as `high`, `max`, or `minimal`; pass an explicitly requested value unchanged and let OpenCode validate it.
