# Chapter 7: 3D Graphics, Tools & Physics

> Source: `3D` / `3D graphics` / `3D tools` / `3D physics` spines

## Core Idea
Godot 3D shares its scene/script patterns with 2D but adds a 3D renderer,
three physics bodies in 3D, and a richer navigation / occlusion toolset.
Pick the right **renderer** (Forward+, Mobile, Compatibility) **once per
project**, before art begins.

## Frameworks Introduced
- **Three 2D/3D renderers** (`Forward+`, `Mobile`, `Compatibility`):
  - `Forward+` (default) — desktop high-end, full effects, compute shaders.
  - `Mobile` — mobile, lower-overhead clustered forward.
  - `Compatibility` — OpenGL ES 3.0 fallback; for older devices or
    when you don't need Forward+ features.
  - Pick at project start; switching is non-trivial.
- **3D physics bodies**: `StaticBody3D`, `RigidBody3D`, `CharacterBody3D`,
  `Area3D` — same decision matrix as 2D, applied to Z.
- **Navigation via `NavigationRegion3D` + `NavigationAgent3D`** — agent
  computes paths automatically with obstacle avoidance.
- **CSG / `MeshInstance3D`** — combine primitives (`CSGCombiner3D`) or
  place raw `.glb` / `.obj` models.
- **Light probes via `LightmapGI`** — bake indirect lighting into
  `*.exr` lightmaps for static scenes.

## Key Concepts
- **`Camera3D`** — perspective; **multiple cameras** stack (UI, minimap,
  security-cam).
- **`WorldEnvironment`** — global env (sky, ambient, fog, glow, SSAO,
  DOF, etc.).
- **`MeshInstance3D` + material** — every visible mesh; materials are
  `StandardMaterial3D` (PBR) or `ShaderMaterial` (custom).
- **`@tool` scripts** on materials / meshes → live update in the editor.

## Code Examples
```gdscript
# free-look camera
extends Camera3D

@export var rot_speed: Vector2 = Vector2(0.2, 0.2)

func _unhandled_input(event: InputEvent) -> void:
    if event is InputEventMouseMotion and Input.is_action_pressed(&"ui_cancel"):
        rotate_y(deg_to_rad(-event.relative.x * rot_speed.x))
        rotate_object_local(Vector3.RIGHT, deg_to_rad(-event.relative.y * rot_speed.y))
```
```gdscript
# navigation agent chase
extends CharacterBody3D
@onready var agent: NavigationAgent3D = $NavigationAgent3D

func _physics_process(_d: float) -> void:
    if agent.is_navigation_finished():
        return
    var next := agent.get_next_path_position()
    velocity = (next - global_position).normalized() * speed
    move_and_slide()
```
```gdscript
# 3rd-person camera follow rig
extends Node3D
@export var target: NodePath
@onready var t := get_node(target) as Node3D

func _process(d: float) -> void:
    var offset := transform.basis * Vector3(0, 2, 6)
    global_position = global_position.lerp(t.global_position + offset, 0.15)
    look_at(t.global_position + Vector3.UP, Vector3.UP)
```
- **What it demonstrates**: `rotate_object_local` for pitch, `NavigationAgent3D`
  for pathfinding, `look_at` for camera target tracking.

## Reference Tables
| Renderer | When |
|---|---|
| `Forward+` | desktop high-end; volumetric fog, SDFGI, compute shaders |
| `Mobile` | phones, lower-end laptops |
| `Compatibility` | broadest device support, OpenGL ES 3.0 |

| Body | Decision |
|---|---|
| `CharacterBody3D` | Player, NPC, anything movement-controlled by code |
| `RigidBody3D` | Crates, ragdolls, physics-driven objects |
| `StaticBody3D` | Level geometry |
| `Area3D` | Triggers, zones |

## Anti-patterns
- **Switching renderer mid-project** — possible but expensive; lock it
  in via `project.godot`.
- **Light-mapping with moving geometry** — lightmaps are baked; moving
  objects read from `VoxelGI` or probes.
- **Single huge `MeshInstance3D`** — split into pieces you can swap at
  LOD with `visible_distance_end`.

## Key Takeaways
1. **Renderer choice is project-locked — pick at startup.**
2. **`WorldEnvironment` does 80% of the visual mood work** — sky,
   ambient, fog, glow, AO.
3. **NavigationRegion3D + NavigationAgent3D replaces pathfinding code.**

## Connects To
- **Ch 9 — Rendering**: pickers are part of rendering; meshes and
  shaders are in shader chapters.
- **Ch 10 — Inputs**: third-person controllers compose input + camera +
  CharacterBody3D.
