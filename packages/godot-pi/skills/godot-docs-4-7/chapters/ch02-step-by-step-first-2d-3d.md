# Chapter 2: Step-by-Step — Your First 2D / 3D Game

> Source: `Step by step` & `Your first 2D game` / `Your first 3D game` spines

## Core Idea
Godot ships **two complete walk-through tutorials** in the docs — one for
2D (`Your first 2D game`, "Dodge the Creeps"-style) and one for 3D
("Squash the Creeps"). Both build the same canonical pattern: one
`Player` scene, one `Mob` scene, one `Main` scene that spawns mobs, an
`HUD` overlay, and a global `Score` autoload. Internalize that pattern and
you can ship 80 % of small games.

## Frameworks Introduced
- **Auto-instanced child with `@onready`**: declare
  `@onready var sprite := $Sprite` — resolves at `_ready()`, never `null`.
- **Spawning with `Timer` + `PathFollow2D / Path3D`**: instead of polling
  every frame, set a `Timer.wait_time`, connect to `timeout`, and choose
  a random spawn position along a parented `Path2D / Path3D`.
- **Group membership for collision queries**: add nodes to `"mobs"` group,
  query with `get_tree().get_nodes_in_group("mobs")`.
- **HUD via `CanvasLayer`**: HUD elements ignore the world transform and
  stay pixel-aligned even as the camera zooms.

## Key Concepts
- **`_process(delta)`** — runs every frame; for input use `_physics_process`.
- **`_unhandled_input(event)`** — receives `InputEvent` not consumed by
  `Control._gui_input` / `Button`, etc.
- **InputMap actions** — define named actions (`"jump"`, `"move_left"`) in
  Project Settings → Input Map; bind keyboard / mouse / gamepad to one name.
- **`MainLoop.physics_fps` (60 by default)** — physics ticks at a fixed
  rate; interpolate visuals with `lerp` if you need sub-step smoothing.

## Code Examples
```gdscript
# mob_spawner.gd (canonical 2D tutorial)
extends Path2D

@export var mob_scene: PackedScene
@onready var spawn_timer: Timer = $SpawnTimer

func _on_spawn_timer_timeout() -> void:
    var mob := mob_scene.instantiate()
    add_child(mob)
    # PathFollow2D path progress 0..1 places it along the curve
    ($PathFollow2D as PathFollow2D).progress_ratio = randf()
```
```gdscript
# player.gd — input via action, not raw keys
func _physics_process(delta: float) -> void:
    var dir := Input.get_vector("move_left", "move_right", "move_up", "move_down")
    velocity = dir * speed
    move_and_slide()
```
- **What it demonstrates**: action-based input, `move_and_slide()` for
  built-in collision response, `instantiate()` of a `PackedScene` reference.

## Reference Tables
| Helper | Use it for |
|---|---|
| `move_and_slide()` | `CharacterBody2D / 3D` with sliding collision response |
| `move_and_collide()` | one-shot movement tests |
| `interpolate_property()` on `Tween` | cheap UI / camera animations |
| `instantiate()` | create a fresh scene instance; reuse the `PackedScene` |
| `queue_free()` | safe destruction at end of frame; never `free()` directly |

## Anti-patterns
- **Polling `Input.is_action_pressed` in `_process` for character
  movement** — use `_physics_process`, otherwise you tie movement to
  framerate.
- **Spawning mobs from a fixed `Vector2`** — looks robotic; use `Path2D`
  with `PathFollow2D.progress_ratio = randf()`.
- **Forgetting to release `InputEvent`** in `_unhandled_input` for UI
  buttons — let `Control` consume them; don't double-handle.

## Key Takeaways
1. **Two scenes + one Main + one HUD** is the canonical small-game skeleton.
2. **Actions over raw `Input.is_key_pressed`** — remappable, gamepad-ready.
3. **Tween or animate via `AnimationPlayer`** — don't write your own timer.
4. **Ship your first vertical slice in an afternoon** by following the
   in-docs tutorial literally; refactor afterwards.

## Connects To
- **Ch 5 — Best practices**: patterns this tutorial implies (groups,
  autoload singletons) get formal treatment there.
- **Ch 7 — Physics**: `CharacterBody2D` and `RigidBody2D` differ in when
  to use which.
