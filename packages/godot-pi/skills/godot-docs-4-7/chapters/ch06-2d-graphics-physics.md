# Chapter 6: 2D Graphics, Tools & Physics

> Source: `2D` / `2D graphics` / `2D tools` / `2D physics` spines

## Core Idea
Godot 2D is **not a 3D engine flattened to Z=0**: it ships a dedicated
2D renderer (`CanvasItem` pipeline), a 2D physics server, and 2D-native
tools (`TileMap`, `Path2D`, `Polygon2D`, `Skeleton2D`). Use the 2D-native
nodes; reaching for 3D nodes in a 2D project fights the engine.

## Frameworks Introduced
- **CanvasItem render order**: siblings render in tree order by default
  (later = on top). `z_index` and `y_sort_enabled` give explicit control.
- **`_draw()` for procedural art**: override `_draw()` on a `Node2D` and
  call `draw_circle`, `draw_rect`, `draw_polygon`. Recompute only when
  data changes (`queue_redraw()`).
- **`TileMap` with `TileSetAtlasSource`** for grid-based levels —
  handles occluders, navigation polygons, terrain transitions.
- **Lights via `PointLight2D` / `DirectionalLight2D`** in normal /
  additive blend modes; `CanvasModulate` tints the whole scene.
- **2D physics layers & masks**: bodies have `collision_layer` (bits 1–32
  set on them) and `collision_mask` (bits they collide against). Use this
  to make "player vs enemy" without per-body `if`.

## Key Concepts
- **`CanvasLayer`** — separate transform / modulate, ideal for HUD.
- **`Sprite2D` vs `AnimatedSprite2D`** — single frame vs sprite-sheet
  animation driven by `AnimationPlayer` or by code.
- **`Area2D`** — overlap detection without physics response. Mouse-over,
  pick-ups, damage zones.
- **`CharacterBody2D`** — kinematic; you move it manually each frame.
- **`RigidBody2D`** — engine-driven physics (gravity, impulses).

## Code Examples
```gdscript
# procedural draw
extends Node2D

@export var radius: float = 48.0

func _process(_delta: float) -> void:
    queue_redraw()  # redraw every frame (only the parts you need)

func _draw() -> void:
    draw_circle(Vector2.ZERO, radius, Color.RED)
```
```gdscript
# CharacterBody2D pattern (jump)
func _physics_process(_delta: float) -> void:
    velocity.y += gravity * _delta
    if Input.is_action_just_pressed(&"jump") and is_on_floor():
        velocity.y = -jump_velocity
    move_and_slide()
```
```gdscript
# Area2D detection
func _on_pickup_area_area_entered(area: Area2D) -> void:
    if area.is_in_group("coins"):
        area.get_parent().queue_free()
```
- **What it demonstrates**: `queue_redraw()` rather than unconditional
  redraw, typed signals from collision shapes (`area_entered`), and
  common `is_on_floor()` + jump combo.

## Reference Tables
| Node | Use it for |
|---|---|
| `Node2D` | plain position |
| `Sprite2D` / `AnimatedSprite2D` | still / animated art |
| `Polygon2D` / `Line2D` | procedural shapes |
| `CanvasLayer` + `Control` | HUD layered over world |
| `Area2D` | overlap (no physics response) |
| `CharacterBody2D` | player / kinematic thing |
| `RigidBody2D` | crates, debris, physics-driven objects |
| `TileMap` | grid-based worlds |

| Physics body decision | Pick |
|---|---|
| Player, NPC, anything you control with logic | `CharacterBody2D` |
| Crates, balls, anything the engine should simulate | `RigidBody2D` |
| Damage zones, pickups, checkpoints | `Area2D` |
| Static level geometry | `StaticBody2D` |

## Anti-patterns
- **Using `RigidBody2D` for the player** — you lose frame-accurate
  input. `CharacterBody2D` is the right call.
- **Per-frame `_draw()` with no `queue_redraw()`** — same outcome but
  semantically cleaner; Godot 4 is smarter here than 3.x was.
- **Neglecting `collision_layer` / `collision_mask`** — results in
  wrong collisions and the dreaded "collides with everything" surprise.

## Key Takeaways
1. **Default to 2D-native nodes.** Don't `Node3D` + orthographic camera.
2. **Layers/masks beat `if`-checks** for collision filtering.
3. **`CharacterBody2D` for control, `RigidBody2D` for simulation.**

## Connects To
- **Ch 7 — 3D**: same body-decision matrix exists in 3D; the 2D/3D
  decision is the first fork.
- **Ch 9 — Rendering**: `CanvasItem` rendering pipeline lives under
  the same backend.
