---
name: godot-project-audit
description: Audit a Godot 4 project structure (project.godot, scenes, scripts, autoloads) and suggest fixes. Use when opening or reviewing a Godot game project.
---

# Godot project audit

Aligned with ProjectSettings keys and *Project organization* guidance: Godot **does not mandate** a folder layout.

## Check

1. `project.godot`
   - Root `config_version` (Godot 4.x projects typically use `5`).
   - `[application]`: `config/name`, `run/main_scene` (full setting paths: `application/config/name`, `application/run/main_scene`).
   - `[autoload]`: entries and whether they belong as globals.
2. Layout — compare to project habits; docs often group assets **near the scenes that use them**, prefer `snake_case` paths, and top-level `addons/` for third-party. Flat `scenes/`+`scripts/`+`assets/` is fine if consistent — flag chaos, not “wrong style”.
3. Autoloads — globals that should be scene-local; circular deps; scripts that don’t extend `Node`.
4. Main scene path exists; skim entry scripts for obvious errors (don’t assume the editor is open).

## Output

- Snapshot (3–6 bullets)
- Risks (ordered)
- Top fix with exact paths

If X-agent Godot tools are enabled and the editor RPC is up, you may `ping` / `get_editor_info` for live context — still prefer files on disk as source of truth.
