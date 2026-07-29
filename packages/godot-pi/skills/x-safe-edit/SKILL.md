---
name: x-safe-edit
description: Small, reversible edits with an explicit verification step. Use when changing code or assets where risk of breakage is high or scope must stay tight.
---

# Safe edit

## Discipline

1. **Scope** — Touch only files needed for the agreed behaviour.
2. **Step size** — Prefer one coherent change set over drive-by cleanups.
3. **Reversibility** — Avoid irreversible data/format migrations unless requested.
4. **Verify** — After edits, state how to check: unit test command, build, or (for Godot) reload/play via editor RPC if tools are enabled.

## Stop conditions

If the change expands beyond the brief, pause and confirm with the user before continuing.
