# Cheatsheet — Godot 4.7 Quick Decisions

A pocket reference for fast decisions while coding. Open this when you
pause mid-task and need a yes/no answer.

## Renderer & Project Init

| Question | Decision |
|---|---|
| Desktop PC only? | `Forward+` (default). |
| Mobile? | `Mobile` renderer; small GPU budgets. |
| Oldest device? | `Compatibility` (OpenGL ES 3.0). |
| Compose mode? | `Compatibility` and `Mobile` are subsets — don't depend on `Forward+`-only SDFGI or Volumetric fog. |
| Switching later? | Possible but expensive; **lock it in before art begins.** |

## First Three Files (new project)

1. `project.godot` — Project Settings → Application Config, then render
   + InputMap + Autoload.
2. `scenes/main.tscn` — Root scene, set as `run/main_scene`.
3. `scripts/main.gd` — `extends Node`, attached to main's root.

If you go multiplayer, add `scenes/spawner.tscn` and a
`MultiplayerSpawner`.

## 2D vs 3D, in three questions

| If your game is… | Use… |
|---|---|
| Top-down / pixel / 2.5D | 2D pipeline: `Node2D`, `Sprite2D`, `CanvasItem` shaders |
| Real 3D world | 3D pipeline: `Node3D`, `MeshInstance3D`, `StandardMaterial3D` |
| Mostly UI in front of 3D | 3D world + `CanvasLayer` for UI |

## Body Decision (the matrix)

| Use case | Body |
|---|---|
| Player / NPC / anything you direct | `CharacterBody2D / 3D` |
| Crate / ragdoll / physics-driven object | `RigidBody2D / 3D` |
| Trigger / pickup / zone | `Area2D / 3D` |
| Static walls, floors, terrain | `StaticBody2D / 3D` |

## Memory & Pattern Heuristics

- **Forward+ release builds need Vulkan** — set
  `--rendering-driver vulkan` on first launch.
- **`user://` writes survive** across runs; **`res://` writes do not.**
- **Persistent signals via `CONNECT_PERSIST`** — they survive scene reload.
- **Tweens are cheap** — chain `.tween_property()` / `.tween_callback()`.
- **Static typing in GDScript** — `var x: int = ...` is *not* stylistic;
  it changes runtime path to a typed fast route.
- **Editor plugins live under `addons/<name>/`**; each plugin has a
  `plugin.cfg` + `plugin.gd`.

## Anti-patterns at a Glance

| Tempting | Better |
|---|---|
| `Input.is_key_pressed(KEY_W)` | `Input.is_action_pressed("move_forward")` |
| 5-deep `extends BaseClass` | Compose: scene of nodes + signals |
| `var dict = {}` untyped | `var dict: Dictionary[String, int] = {}` |
| `RigidBody` for the player | `CharacterBody` |
| Manual `position += vel * dt` in `_process` | `move_and_slide()` in `_physics_process` |
| Singleton-everything | `Node` references passed via signals/owners |
| `free()` directly | `queue_free()` (end-of-frame cleanup) |
| Edit-mode `get_node("/root/...A/B/C")` | `@onready var x := $B/C` |
| Hard-coded `res://foo.tres` | `preload()` for parse-time, `ResourceUID` (`uid://…`) for stable handles |

## Tells & Smells

| If you see this… | You're probably in… |
|---|---|
| Inspector errors about "missing `owner`" | `instantiate()` without `edit_state`. |
| Scripts "are already registered" warning | duplicate `class_name` declarations. |
| Black meshes in lit scene | `gi_mode` mismatch (`STATIC` mesh with no `LightmapGI`). |
| Play input reads work in editor, lag in game | polling in `_process` instead of `_physics_process`. |
| Signals not firing after `change_scene_to_*` | you reconnected on the old scene; reconnect on the new root. |
| Tween freezes on scene exit | autoload-managed tween; cancel before `queue_free`. |
| Compile error: "Function expects int, got float" | Variant coercion at GDScript boundary — type the argument. |
| "Play only runs once" | you set `run/main_scene` to a `Node` instead of a `Scene`. |

## Layer Bits (convention)

```
LAYER_PLAYER       = 1 << 1   # also used as mask for what hits player
LAYER_ENEMY        = 1 << 2
LAYER_TERRAIN      = 1 << 3
LAYER_PICKUP       = 1 << 4   # Area, not body
LAYER_HAZARD       = 1 << 5
LAYER_RAYCAST      = 1 << 6   # for masking ray casts only
LAYER_PREDICTION   = 1 << 7   # ghost bodies, ignored by gameplay
```

Set `collision_layer` to *what I am*, `collision_mask` to *what I
collide with*. Document the bits once per project.

## Renderer / Pipeline Defaults

| Setting | Default | Adjust when… |
|---|---|---|
| `Forward+` | desktop | mobile, legacy |
| `Mobile` | phones | battery-bound |
| `Compatibility` | fallback | OpenGL ES 3.0 max |
| `physics_fps` | 60 | turn down for slow sims; turn up for fighting/character games |
| `rendering/anti_aliasing/quality/msaa_3d` | disabled | enable on desert / strong-contrast shaders |

## Performance Sanity Heuristics

- **>1000 draw calls / frame:** combine with `MultiMeshInstance3D`.
- **>500 nodes / frame:** consider instance dumps or octrees
  (`OcbTree` / `GridMap`).
- **>200 AnimPlayer updates:** move to `AnimationTree` blends.
- **Audio buses > 32:** split into parallel sub-mixes with `AudioStreamPlaylist`.

## Quick Decision Trees

### "Where does this gameplay rule live?"

```
Is it per-instance?        →  Node script
Is it shared by all?       →  Autoload OR static helper
Is it designer-editable?   →  Resource (saved as .tres)
Is it conditional per run? →  Pass to Node via @export reference
```

### "Should this be a scene or a script?"

```
Has children?                       →  Scene
Reused in multiple places?          →  Scene (instantiate)
Need inspector-only designer edits? →  Scene
Just a function or pure data?       →  Script / Resource
```
