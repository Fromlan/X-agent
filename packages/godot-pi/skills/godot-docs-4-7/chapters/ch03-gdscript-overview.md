# Chapter 3: GDScript Overview & Language Reference

> Source: `GDScript` / `Scripting` / `GDScript reference` spines

## Core Idea
GDScript is Godot's Python-flavored, Godot-aware scripting language.
It's **optionally typed** (`var x: int = 5`), garbage-collected, **parsed
at runtime** (no compile step), and **statically analyzable** when you opt
in via annotations. It exposes every engine type as first-class syntax —
not as opaque handles.

## Frameworks Introduced
- **Static typing for performance & safety**: declare types → interpreter
  uses optimized calls (Variant → typed fast path), and the editor's
  analyzer surfaces errors at edit time.
  - When to use: any project beyond a single-screen demo.
  - How: `var speed: float = 200.0`, `func add(a: int, b: int) -> int`,
    `@warning_ignore("unsafe_method_access")` per-line or per-class.
- **`@onready` for cached child lookups**: shorthand for
  `var x = get_node("X")` that waits for `_ready()`.
- **`@export` for editor-exposed fields**: any `var` annotated with
  `@export` shows up in the Inspector with proper widgets (sliders, enums).
- **Inner classes for grouping state**: `class_name PlayerState`
  inside a `.gd` reuses the enum / class across files.

## Key Concepts
- **Variant** is the base type. Every property, every function parameter.
- **Annotations** (`@export`, `@onready`, `@rpc`, `@warning_ignore`, etc.)
  drive both runtime behavior and editor integration.
- **Coroutines** (`await`, `func _on_timer_timeout() -> void: await get_tree()
  .create_timer(1.0).timeout`) replace callbacks for one-shot waits.
- **`class_name`** declares a global identifier that the editor lists in
  "Create New Node" and the API reference cross-links automatically.
- **`preload()` vs `load()`**: parse-time vs runtime resource load.

## Code Examples
```gdscript
extends CharacterBody2D
class_name Player

@export var speed: float = 220.0
@export var jump_velocity: float = -360.0

@onready var sprite: AnimatedSprite2D = $AnimatedSprite2D

func _physics_process(delta: float) -> void:
    var dir := Input.get_vector(&"ui_left", &"ui_right", &"ui_up", &"ui_down")
    velocity.x = dir.x * speed
    velocity.y += get_gravity().y * delta
    if is_on_floor() and Input.is_action_just_pressed(&"ui_accept"):
        velocity.y = jump_velocity
    move_and_slide()
```
```gdscript
# typed signal + RPC
signal health_changed(new_value: int)

@rpc("any_peer", "call_local", "reliable")
func take_damage(amount: int) -> void:
    health_changed.emit(amount)
```
- **What it demonstrates**: typed `class_name`, `@export` editor hook,
  `&"name"` StringName literal, `@onready` cache, full character-body
  physics in ~10 lines.

## Reference Tables
| Annotation | Purpose |
|---|---|
| `@export` | Show a property in the Inspector |
| `@export_range("0,100,1")` | Slider widget with min/max/step |
| `@onready` | Resolve node path at `_ready()` |
| `@rpc(...)` | Mark a function as remotely callable |
| `@warning_ignore("...")` | Suppress a specific analyzer warning |
| `@tool` | Run this script in the editor (e.g. for custom `Control`s) |
| `@icon("res://icon.svg")` | Custom class icon |

| Built-in pattern | Used when |
|---|---|
| `await get_tree().create_timer(t).timeout` | one-shot delay |
| `tween.tween_property(node, "position", end_pos, 0.5)` | smooth interp |
| `Input.get_vector(neg_x, pos_x, neg_y, pos_y)` | 2-axis movement |
| `OS.get_unique_id()` | per-device identifier (saves) |
| `RenderingServer.frame_pre_draw` signal | hook into render thread |

## Anti-patterns
- **Untyped `var dict = {}`** → Dictionary slows down; use
  `var dict: Dictionary[String, int] = {}`.
- **Awaiting timers *and* emitting signals for the same event** — pick
  one; `await` reads as a coroutine, signals as a port.
- **Heavy work in `_process` for many nodes** — use a single manager and
  signals, or batch into `_physics_process`.

## Key Takeaways
1. **Type aggressively** — annotated code runs faster and edits safer.
2. **`@export` + `@onready` are your Inspector glue** — every gameplay
   parameter is an `@export`, every cached node is `@onready`.
3. **`class_name` makes your scripts first-class** — they appear in
   "Add Node" and `help()` searches.
4. **Coroutines beat callbacks for one-shot waits**.

## Connects To
- **Ch 4 — Signals in depth**: coroutines and signals complement each
  other (`await` a signal: `await player.scored`).
- **Ch 11 — Networking**: `@rpc` annotations are the GDScript face of
  high-level multiplayer.
