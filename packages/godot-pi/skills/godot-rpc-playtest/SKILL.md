---
name: godot-rpc-playtest
description: Drive X-agent Godot editor RPC for playtesting and error triage. Use when running scenes, collecting debugger errors, importing assets, or debugging play-time failures via Godot tools.
---

# Godot RPC playtest

Requires **Settings → Tools**: Godot editor tools enabled, and editor RPC connected (see `/godot-rpc-status`).

## Typical flow

1. `ping` / `get_editor_info` — confirm connection and active client.
2. Open or reload the scene under test if needed.
3. `run_current_scene` or `play_main_scene` — then `get_play_errors` (short window).
4. Fix root cause in scripts/scenes (small steps).
5. Re-run until clean, or `stop_scene`.

## Assets

- `import_resources` after adding/changing importable files when the editor should reimport.

## If tools unavailable

Say so and fall back to instructing the user to run from the Godot editor manually.
