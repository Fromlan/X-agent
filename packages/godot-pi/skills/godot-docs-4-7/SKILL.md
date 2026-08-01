---
name: godot-docs-4-7
description: "Godot 4.7 conventions and API patterns. Use when asking about Godot/GDScript, scene composition, signals, CharacterBody vs RigidBody, InputMap, @export/@onready/@rpc, Forward+/GI, AnimationTree/Tween, shaders, multiplayer, or export/plugin."
---

<!-- argument-hint: [topic, framework name, or chapter number, e.g. 'signal', '@rpc', 'CharacterBody3D', 'ch07'] -->

# Godot Docs 4.7 (Distilled Reference)
**Author**: Godot Engine contributors (community-driven, MIT) | **Pages**: ~1,679 spine items | **Chapters**: 12 (topical) | **Generated**: 2026-08-01

## How to Use This Skill

1. Map the question via **Topic Index** (or Chapter Index / cheatsheet / patterns / glossary).
2. **Before answering**: read every matched chapter file; for yes/no or matrix decisions also read [cheatsheet.md](cheatsheet.md); for recipes read [patterns.md](patterns.md).
3. **Done only when** those files have been read and the answer cites the relevant framework (Core alone is not enough when a Topic Index hit exists).

Browse: ask for chapter list, `cheatsheet`, `patterns`, or `glossary`.

---

## Core Frameworks & Mental Models

<!-- ~2,000 tokens — most important knowledge first; reorder if needed. -->

### 1. Composition over inheritance (the Godot way)
Every gameplay entity is a **scene tree of nodes**, not a deep class hierarchy.
- Build behavior from small nodes (`Node2D` / `Node3D` / `Control` + specialised children) wired by signals.
- Save subtrees as `.tscn`; reuse via `PackedScene.instantiate()`.
- **Default to scenes, fall back to scripts only when flexibility requires it.**
- (Ch 1)

### 2. Signals as the universal decoupling layer
`Object.signal name(args)`; `name.emit(args)`; `node.name.connect(callable, flags)`.
- Always prefer signals over cross-node `get_node` calls.
- Use flags: `CONNECT_DEFERRED` (idle-time safety), `CONNECT_PERSIST` (saved in scene), `CONNECT_ONE_SHOT`.
- **Type your signals** (typed parameters surfacing editor-time errors).
- (Ch 4)

### 3. Action-based input
Define `"jump"`, `"move_left"`, etc. once in `Project Settings → Input Map`; bind all devices.
Read with `Input.get_vector(&"move_left", &"move_right", ...)`, `Input.is_action_just_pressed(&"jump")`.
- Never read raw `KeyEvent`s; remapping is for free if you do.
- (Ch 10)

### 4. Optional static typing in GDScript
`var x: int = 5` → typed fast path + analyzer errors at edit time. Mark `@warning_ignore(...)` per-line.
- For anything beyond a demo, type aggressively.
- (Ch 3)

### 5. `@export` for designers, `@onready` for caches
- `@export` exposes a property to the Inspector (variants: `@export_range`, `@export_enum`, `@export_resource("Type")`).
- `@onready var x := $Path` resolves at `_ready()` so `$Path` is never null.
- (Ch 3)

### 6. Forward-decide the renderer
Lock renderer at project creation (Forward+ / Mobile / Compatibility). Switching later is expensive.
- Forward+ — desktop, full effects (SDFGI, volumetric fog).
- Mobile — phones, lower overhead.
- Compatibility — OpenGL ES 3.0 fallback.
- (Ch 7, 9)

### 7. Body decision matrix (2D and 3D)
| Need | Body |
|---|---|
| Player, NPC, boss (you drive motion) | `CharacterBody2D / 3D` + `move_and_slide` |
| Crate, ragdoll, debris (engine simulates) | `RigidBody2D / 3D` |
| Trigger / pickup / zone (overlap only) | `Area2D / 3D` |
| Static level geometry | `StaticBody2D / 3D` |

- Use collision **layer** (what I am) and **mask** (what I collide with) — 32-bit bitfields, much cleaner than `if`-checks.
- (Ch 6, 7)

### 8. High-level multiplayer: `@rpc`, `MultiplayerSpawner`, `MultiplayerSynchronizer`
- `@rpc("any_peer", "call_local", "reliable") func chat(msg: String): …` — annotate any function as remotely callable; modes include `"authority"`, `"call_local"`, transports `"reliable"`/`"unreliable"`.
- `MultiplayerSpawner` replicates scene instantiation from authority to clients.
- `MultiplayerSynchronizer` + `SceneReplicationConfig` replicate properties by mode (always / on_change / initial).
- (Ch 11)

### 9. Resources as data, Nodes as logic
Anything reusable (textures, sounds, materials, weapons) is a `Resource` saved as `.tres`; entities (`Node`s) carry behavior and reference resources.
- Use `@export_resource("Type")` to bind resource subtypes.
- Stable handles: `uid://b1234…` survive renames.
- (Ch 4, 5)

### 10. Persistence in `user://` (not `res://`)
`FileAccess.open("user://save.json", FileAccess.WRITE).store_string(JSON.stringify(d))`.
- `user://` is per-user and writable; `res://` is read-only after export.
- Use `JSON.stringify(d, "\t")` for portable, version-tagged saves.
- (Ch 11)

### 11. Tween for any one-shot visual interpolation
`var t := create_tween(); t.tween_property(node, "scale", Vector2.ONE * 1.1, 0.15)` — also `tween_callback(node.queue_free)`.
- Use over `_process` for any UI / camera / shader pulse.
- (Ch 8, 10)

### 12. WorldEnvironment & GI choices
- One `WorldEnvironment` per scene for fog / sky / SSR / glow.
- Pick per-project: `VoxelGI` (real-time), `LightmapGI` (baked), `SDFGI` (Forward+ only).
- `mesh.gi_mode` must match: `STATIC`, `DYNAMIC`, `LIGHTMAPPED`, `NONE`.
- (Ch 9)

### 13. Editor extensibility via `EditorPlugin`
Place in `addons/<name>/`:
```
[plugin]
name="My Plugin"
script="plugin.gd"
```
```gdscript
@tool extends EditorPlugin
func _enter_tree() -> void: add_custom_type("MyTool","Node",preload("tool.gd"),preload("icon.svg"))
func _exit_tree() -> void: remove_custom_type("MyTool")
```
Mark scripts `@tool` to run in the editor. (Ch 12)

### 14. Autoloads reserved for infrastructure
Use `Project Settings → Autoload` for **truly cross-cutting state**: save manager, audio bus, networking peer. Do **not** autoload everything. (Ch 5)

### 15. CI / Headless release pipeline
`godot --headless --path proj --export-pack "Linux/Server" build/server.x86_64` covers >90% of build cases. (Ch 12)

---

## Chapter Index

| # | Title | Key Frameworks |
|---|-------|----------------|
| [ch01](chapters/ch01-introduction-and-philosophy.md) | Introduction & Design Philosophy | Scene/Node/Tree composition, signals, all-inclusive package |
| [ch02](chapters/ch02-step-by-step-first-2d-3d.md) | Step-by-Step: First 2D / 3D Game | Player + Mob + Main + HUD skeleton; `@onready` & InputMap |
| [ch03](chapters/ch03-gdscript-overview.md) | GDScript Overview & Language Reference | Static typing, `@export` / `@onready` / `@rpc`, `class_name` |
| [ch04](chapters/ch04-signals-resources-scenes.md) | Signals, Resources & Scenes | Signal flags, `Resource`, `PackedScene.instantiate()` |
| [ch05](chapters/ch05-best-practices.md) | Best Practices & Project Workflow | Autoloads, file conventions, VCS `.gitignore` |
| [ch06](chapters/ch06-2d-graphics-physics.md) | 2D Graphics, Tools & Physics | CanvasItem, TileMap, CharacterBody2D, layers/masks |
| [ch07](chapters/ch07-3d-graphics-physics.md) | 3D Graphics, Tools & Physics | Forward+/Mobile/Compatibility, NavigationAgent3D, LightmapGI |
| [ch08](chapters/ch08-shaders-audio-animation.md) | Shaders, Audio, Animation | `.gdshader`, AudioBus, AnimationTree/StateMachine, Tween |
| [ch09](chapters/ch09-rendering-materials.md) | Rendering, Materials & Lighting | WorldEnvironment, GI modes, SubViewport, LOD |
| [ch10](chapters/ch10-inputs-ui-tween.md) | Inputs, UI (Control), Tween | InputMap actions, Container layout, Tween chains |
| [ch11](chapters/ch11-networking-files.md) | Networking, Multiplayer & Files | `@rpc`, Spawner/Synchronizer, FileAccess, uid:// |
| [ch12](chapters/ch12-editor-export-plugin.md) | Editor, Exporting, Plugins & Debugging | EditorPlugin, `--export-pack`, `@tool`, performance monitor |

## Topic Index

- **2D body** → ch06
- **3D body** → ch07
- **`@onready`** → ch03
- **`@export` / `@export_range` / `@export_resource`** → ch03, ch10
- **`@rpc`** → ch11
- **`@tool`** → ch12
- **AnimationPlayer / AnimationTree** → ch08
- **Area2D / Area3D** → ch06, ch07
- **AudioStreamPlayer** → ch08
- **Autoloads** → ch05
- **`CanvasLayer`** → ch06, ch10
- **`CanvasModulate`** → ch06
- **CharacterBody2D / 3D** → ch06, ch07
- **`class_name`** → ch03, ch05
- **Collision layers / masks** → ch06, ch07
- **Compatibility renderer** → ch07, ch09
- **`CONNECT_DEFERRED`** → ch04
- **`CONNECT_PERSIST`** → ch04
- **`Container` (VBox/HBox/Grid)** → ch10
- **EditorPlugin** → ch12
- **ENet** → ch11
- **`export-pack`** → ch12
- **Forward+ renderer** → ch07, ch09
- **GI mode** → ch09
- **`@global` Constants** → ch03
- **High-level multiplayer** → ch11
- **InputMap actions** → ch10
- **`Input.get_vector`** → ch10
- **JSON save** → ch11
- **`LightmapGI`** → ch09
- **Material override** → ch09
- **Mobile renderer** → ch07
- **MultiplayerSpawner** → ch11
- **MultiplayerSynchronizer** → ch11
- **`move_and_slide`** → ch06, ch07
- **NavigationAgent3D** → ch07
- **`PackedScene`** → ch04
- **Path2D / Path3D** → ch02, ch07
- **Pixel-y retro games** → ch06
- **Pixel style shaders** → ch08
- **Plugins** → ch12
- **Project organization** → ch05
- **Render layers (2D)** → ch09
- **Resource (.tres)** → ch04, ch05
- **`res://` vs `user://`** → ch05, ch11
- **RigidBody2D / 3D** → ch06, ch07
- **ShaderMaterial** → ch08, ch09
- **Signals (typed)** → ch04
- **`Sprite2D` / `AnimatedSprite2D`** → ch06
- **StateMachine (AnimationTree)** → ch08
- **StaticBody2D / 3D** → ch06, ch07
- **`SubViewport`** → ch09
- **TileMap** → ch06
- **Tween** → ch08, ch10
- **`uid://`** → ch11
- **Variant** → ch03
- **`VoxelGI`** → ch09
- **WorldEnvironment** → ch09

## Supporting Files

- [glossary.md](glossary.md) — every key term, alphabetized (Ch references)
- [patterns.md](patterns.md) — 15 reusable recipes with trade-offs
- [cheatsheet.md](cheatsheet.md) — body decision matrix, layer-bit convention, anti-pattern table, tells-and-smells

## Scope & Limits

This skill covers **Godot 4.7 reference**. It is **engine-oriented** — it
does not include project-specific business logic, asset pipelines, or
custom editor tooling from your codebase. When the question drifts into
your project's specifics, combine with project tools, the project's own
CLAUDE.md, and live runtime inspection. For topics *beyond* this distil
(e.g. mobile platform signing, Steam integration, console SDKs), check
the official docs at https://docs.godotengine.org or the relevant
vendor guide.
