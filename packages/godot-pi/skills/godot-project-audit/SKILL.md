---
name: godot-project-audit
description: Audit a Godot 4 project structure (project.godot, scenes, scripts, autoloads) and suggest fixes. Use when opening or reviewing a Godot game project.
---

# Godot Project Audit

You are helping with a **Godot 4** project inside X-agent.

## Steps

1. Locate `project.godot` from the cwd (or ask the user for the project root).
2. List top-level folders (`scenes/`, `scripts/`, `assets/`, `addons/`) and note missing conventions.
3. Check for common issues:
   - Orphan `.tscn` / `.gd` without references
   - Autoload names that collide
   - `config_version` / feature tags incompatible with Godot 4.x
4. Prefer GDScript idioms from Godot 4 (`@onready`, signals, typed arrays).
5. Summarize findings as a short checklist with actionable edits.

## Constraints

- Do not invent Godot 3 APIs (`yield`, `connect("signal", obj, "method")` old style) unless the project is clearly 3.x.
- Prefer `read` / `grep` / `find` before rewriting files.
