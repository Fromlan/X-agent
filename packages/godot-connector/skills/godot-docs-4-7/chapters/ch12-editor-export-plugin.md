# Chapter 12: Editor, Exporting, Plugins & Debugging

> Source: `Editor` / `Export` / `Plugins` / `Debug` spines

## Core Idea
The Godot editor itself is a Godot project; you can add UI via
`EditorPlugin`s, register custom nodes via `class_name` or
`@tool`, and ship headless server builds from the same project. Master
export presets + remote `gdb` / `renderdoc` debugging before release.

## Frameworks Introduced
- **`EditorPlugin`** — GDScript or C# class added to `addons/<name>/plugin.cfg`;
  registers types (`add_custom_type`, `add_custom_node_2d_node`),
  autoloads, inspector extensions, dock panels, import hooks, etc.
- **Export presets (`*.gdpc` files in `addons/<name>/`)** — desktop
  presets for Windows / macOS / Linux, mobile (Android, iOS), Web (HTML5),
  and consoles (with SDK access). Encryption keys go here.
- **Headless build for CI / dedicated server**:
  `godot --headless --export-pack "Server" build/game.x86_64`.
- **Remote inspector**: connect a debug instance to the editor via
  `Remote Transform` / `Remote Tree` / editor's
  `MultiplayerDebugger`. Great for device debugging.

## Key Concepts
- **Project manager vs editor** — `godot` opens Project Manager; double-click
  a project, or `godot project_name/`.
- **Command-line flagship commands**:
  - `--path /proj` — set project dir.
  - `--import` — headless import pass for CI.
  - `--export-pack "Name" out.x86_64` — build.
  - `--check-only` — validate without running.
  - `--headless` — no window, no audio device.
- **Custom Resource importers**: `EditorImportPlugin` lets you write a
  new parser (e.g. `.kif` beatmap → `SongData` resource).
- **`@tool` scripts** — same script executes in the editor (for `Control`
  previews, custom inspectors).
- **Profiler / Debugger / PerformanceMonitor** — built-in, attach to
  remote process.

## Code Examples
```ini
# addon.cfg (in your addon folder)
[plugin]
name="My Tools"
description="Adds an HP bar icon for the Inspector."
author="Me"
version="1.0"
script="plugin.gd"
```
```gdscript
# plugin.gd — minimal plugin
@tool
extends EditorPlugin

const Tool := preload("tool.gd")

func _enter_tree() -> void:
    add_custom_type("MyTool", "Node", Tool, preload("icon.svg"))

func _exit_tree() -> void:
    remove_custom_type("MyTool")
```
```bash
# CI export cheat-sheet
godot --headless --path project \
    --export-pack "Linux/Server" build/server.x86_64
godot --headless --path project \
    --export-pack "Windows/Desktop" build/win/x86_64/X.exe
```
```gdscript
# @tool for live preview of a UI element
@tool
extends Control
@export var label_text: String = "":
    set(v):
        label_text = v
        if label: label.text = v
```
- **What it demonstrates**: minimal `EditorPlugin` that registers a custom
  type, `--export-pack` for server/desktop in one line each, a `@tool`
  Control whose label tracks the exported `label_text`.

## Reference Tables
| Editor surface | Touch with |
|---|---|
| Inspector | `@export`, `@export_*` annotations |
| Scene tree | signals + `editor_description` (search-only) |
| FileSystem dock | import_settings via `.import` files |
| Custom dock | `add_control_to_dock(name, control)` |
| Custom type | `add_custom_type(name, base, script, icon)` |
| Autoload | Project Settings → Autoload (also via plugin) |
| Export presets | Project → Export → preset files (`*.gdpc`-style in `addons/`) |

| `godot` CLI | Use |
|---|---|
| `--editor --path proj` | open editor |
| `--headless --import --path proj` | CI import |
| `--export-pack "Preset" out` | build packaged game |
| `--check-only` | script error pass |
| `--quit-after 60` | run 60 frames and exit |

## Anti-patterns
- **Pointing clients at a host on LAN without UPnP** — most home
  routers need port forwarding; WebSocket backends bypass this.
- **Bundling entire addons folder with the export** — keep them under
  `addons/` for source only; pre-compile your plugin via `--export-pack`.
- **Debug-print in shipped builds** — wrap with
  `if OS.is_debug_build(): print(...)` or use `OS.get_cmdline_args()` checks.

## Key Takeaways
1. **Editor plugins via `addons/<name>/`** — `[plugin].cfg` + a
   `plugin.gd`; declare registered types in `_enter_tree`, undo in
   `_exit_tree`.
2. **`--headless --export-pack`** is the entire CI build pipeline.
3. **`@tool` makes UI live in the editor**, not the running game.

## Connects To
- **Ch 5 — Best practices**: export presets persist with project state.
- **Ch 11 — Networking**: dedicated server build uses `--export-pack`.
