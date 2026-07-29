---
name: godot-autoload-patterns
description: Godot 4 Autoload singleton patterns for global state and EventBus. Use when adding autoloads, GameData, EventBus, or global managers.
---

# Autoload patterns

Aligned with Godot docs: *Singletons (Autoload)* and *Autoloads versus regular nodes*.

## When to autoload

Use for **wide-scope** systems that must outlive scene changes (quest/dialogue, true cross-scene services).

Prefer **not** autoloading when:

- Scope is one scene → keep nodes/local state in that scene.
- Shared **data** → a `Resource` (or pass via `owner` / exports).
- Shared **helpers** without instance state → `class_name` + `static func` / `static var` (GDScript 4.1+).

## Engine rules

- Autoload a **scene** or a **script that inherits `Node`**. Autoloading a script creates a `Node`, attaches the script, and adds it under the root **before** the main scene.
- Register via **Project → Project Settings → Globals → Autoload** (persisted under `[autoload]` in `project.godot`). Enabled entries are addressable by name in GDScript (e.g. `PlayerVariables.health`).
- **Do not** `free()` / `queue_free()` autoloads at runtime — the engine can crash.
- An autoload is not a true singleton: the user can still instance the same script/scene elsewhere.

## Patterns

- **EventBus** — typed signals on one autoload; emitters/listeners stay unaware of each other (still a global; use sparingly).
- **GameData** — authoritative runtime state; narrow APIs, not a free-for-all dictionary.
- Keep `_ready` / startup light; avoid allocating huge pools “just in case”.

## Caution

Too many autoloads become an invisible dependency graph — prefer scene-local nodes and signals when scope is local.
