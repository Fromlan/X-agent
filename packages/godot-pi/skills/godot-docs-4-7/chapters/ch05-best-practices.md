# Chapter 5: Best Practices & Project Workflow

> Source: `Best practices` / `Project organization` / `Version control` spines

## Core Idea
Godot has no single "right architecture", but a small set of patterns
keeps projects maintainable. This chapter collects them: **when to use
autoloads, when scenes vs scripts, file organization, version control
hygiene, and analyzer-driven debugging.**

## Frameworks Introduced
- **Autoload (singleton) for truly cross-cutting state**: a `Node` script
  added to Project Settings → Autoload runs once at startup, accessible as
  `MyName.x` from anywhere.
  - When to use: settings managers, save systems, audio buses, multiplayer
    signal hubs.
  - **Don't** use as a global var drawer for "I'll just stash this here".
- **Scenes vs scripts**: if a piece of data needs child nodes, it's a
  scene. If it's pure logic or data, it's a script or `Resource`.
- **Node ownership** — every node has an `owner`; `add_child` inside the
  editor uses the edited scene's root as the implicit owner so saves
  pick up children.

## Key Concepts
- **`@warning_ignore("unused_localizable_string")`** overrides the static
  analyzer per-line.
- **Project organization**: 2D / 3D / assets / scenes / scripts split by
  directory, optional feature plugins under `addons/`.
- **`[gd_resource]` & `[gd_scene]`** are the file formats `.tres` /
  `.tscn`; readable text, diff-friendly.
- **Git `.gitignore`** must exclude `.import/` (Godot regenerates on open),
  but commit `.godot/` Godot 4 settings if you sync editor prefs across
  machines (otherwise exclude too).

## Code Examples
```ini
# project.godot — autoload entry
[application]
config/name="My Game"
run/main_scene="res://scenes/main.tscn"

[autoload]
SaveManager="*res://autoloads/save_manager.gd"
```
```gdscript
# save_manager.gd — canonical autoload pattern
extends Node

const SAVE_PATH := "user://save.json"

func save_game(data: Dictionary) -> void:
    var f := FileAccess.open(SAVE_PATH, FileAccess.WRITE)
    f.store_string(JSON.stringify(data))

func load_game() -> Dictionary:
    if not FileAccess.file_exists(SAVE_PATH):
        return {}
    var raw := FileAccess.get_file_as_string(SAVE_PATH)
    return JSON.parse_string(raw) as Dictionary
```
- **What it demonstrates**: autoload singleton, `user://` per-user data
  directory (Godot-managed, OS-appropriate location),
  `JSON.parse_string` for versioned saves.

## Reference Tables
| Directory | Convention |
|---|---|
| `res://scenes/` | all `.tscn` |
| `res://scripts/` | gameplay `.gd` / `.cs` |
| `res://assets/` | textures, audio, fonts |
| `addons/` | editor plugins or `.zip`-imported GDExtensions |
| `user://` | `FileAccess` per-user writes (outside project) |

| VCS rule | Reason |
|---|---|
| commit `.tres` / `.tscn` / `.gd` | diffable text |
| ignore `.import/` | auto-generated cache |
| ignore `.godot/` only if you don't share editor prefs | keeps config lean |
| commit `project.godot` | canonical project config |

## Anti-patterns
- **Using an autoload for every gameplay global** — global state
  increases coupling; prefer passing references through signals.
- **Long-running coroutines on autoloads** — they survive scene changes,
  remember to `queue_free` their consequences or guard with groups.
- **Mixing `extends Node` autoloads with hand-rolled singletons** —
  pick one; the autoload *is* the singleton mechanism.

## Key Takeaways
1. **Reserve autoloads for cross-cutting infrastructure.**
2. **Make scenes the unit of reuse; make `Resource` the unit of data.**
3. **`user://` for saves, `res://` for assets** — never mix.
4. **Diff-friendly text formats** mean Git PR reviews work cleanly for
   `.gd`, `.tres`, `.tscn`.

## Connects To
- **Ch 11 — Networking**: high-level multiplayer uses an autoload
  `MultiplayerSpawner` and a unique-id autoload manager.
- **Ch 12 — Release pipeline**: export presets live in `project.godot`
  too.
