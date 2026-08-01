# Glossary — Godot Docs 4.7

Key terms from the Godot 4.7 reference. Each entry is a one-sentence
definition with the chapter(s) it appears in. Alphabetical.

- **AnimationPlayer** — node that plays `Animation` resources on its
  target via `_animation_finished` signal (Ch 8).
- **AnimationTree** — node that blends multiple animations, often driven
  by a StateMachine node (Ch 8).
- **Area2D / Area3D** — collision body for overlap events, no physics
  response (Ch 6, 7).
- **`@export`** — annotation that exposes a script variable in the
  Inspector with a typed widget (Ch 3, 5, 12).
- **Autoload** — `Node` script added at project start, reachable as a
  global name (Ch 5).
- **CanvasLayer** — UI layer that ignores world transform, ideal for
  HUD (Ch 6, 10).
- **CharacterBody2D / 3D** — kinematic body, you drive its motion via
  `move_and_slide` (Ch 6, 7).
- **`class_name`** — GDScript declaration that registers a global type
  visible in `Add Node` and the class reference (Ch 3).
- **Collision layer/mask** — 32-bit bitfields on collision bodies that
  filter what collides with what (Ch 6, 7).
- **CONNECT_DEFERRED** — signal flag that runs the handler at idle
  time, safe in loops (Ch 4).
- **CONNECT_PERSIST** — signal flag saved with the scene so connections
  survive load (Ch 4).
- **Control** — base class for all UI nodes (`Button`, `Label`, …); uses
  anchor/offset rect layout (Ch 10).
- **Container (VBox / HBox / Center / Grid / Margin)** — Control that
  auto-arranges its children on resize (Ch 10).
- **`@onready`** — annotation that resolves a `get_node` at `_ready()`,
  not at script load (Ch 3).
- **EditorPlugin** — `addons/<name>/` plugin that registers types /
  docks / importers into the editor (Ch 12).
- **Environment** — resource bound to `WorldEnvironment` that controls
  sky / fog / SSAO / glow (Ch 9).
- **FileAccess** — API to read/write project (`res://`) and user
  (`user://`) files (Ch 11).
- **GDScript** — Godot's Python-flavored, optionally typed scripting
  language (Ch 3).
- **`Input.get_vector(...)`** — cross-device 2-axis movement helper that
  automatically normalizes a diagonal (Ch 10).
- **InputMap** — project-level action declarations with multi-device
  bindings (Ch 10).
- **LightmapGI** — baked global illumination resource (Ch 9).
- **`load()` / `preload()`** — runtime vs parse-time resource loading
  (Ch 3, 11).
- **MultiplayerSpawner** — replicates scene instantiation from
  authority to clients (Ch 11).
- **MultiplayerSynchronizer** — replicates property changes per a
  SceneReplicationConfig (Ch 11).
- **MultiplayerPeer** — transport interface (`ENet`, `WebSocket`, …)
  producing a `MultiplayerAPI` (Ch 11).
- **Node** — base class for everything in the scene tree; child of
  another `Node` (Ch 1).
- **`@rpc`** — annotation marking a function as remotely callable with
  mode + transport qualifiers (Ch 11).
- **PackedScene** — serialized scene resource; `instantiate()` builds a
  fresh tree (Ch 2, 4).
- **Path2D / Path2DFollow / Path3D** — spline for spawn patterns or
  cutscenes (Ch 2, 7).
- **`ProjectSettings.autoload`** — global singleton list at project
  start (Ch 5).
- **Resource** — Godot's universal data asset, saveable as `.tres` (Ch
  4, 5).
- **`res://`** — project-relative resource path; assets live here (Ch
  11).
- **RigidBody2D / 3D** — physics-driven body, engine simulates motion
  (Ch 6, 7).
- **`@tool`** — annotation that runs a script in the editor (Ch 12).
- **Scene** — saved `.tscn` representing a `Node` tree, the unit of
  reuse (Ch 1, 2, 4).
- **Scene tree** — runtime hierarchy of `Node`s; parents own children,
  signals propagate (Ch 1, 4).
- **SceneReplicationConfig** — `.tres` listing property paths for
  MultiplayerSynchronizer (Ch 11).
- **SceneTransition / SceneMain** — set in Project Settings; first
  scene to load on play (Ch 5, 10).
- **ShaderMaterial** — wraps a `.gdshader` script in a resource and
  binds it to a `MeshInstance3D` / Sprite (Ch 8, 9).
- **Signal** — typed event bus on `Object`; `emit()` + `connect()` (Ch
  4).
- **Sprite2D** — single-frame 2D image node (Ch 6).
- **AnimatedSprite2D** — multi-frame 2D animation node (Ch 6).
- **StaticBody2D / 3D** — non-moving collision body (Ch 6, 7).
- **StringName (`&"name"`)** — interned string type, cheaper to compare
  than `String` (Ch 3, 10).
- **SubViewport** — render target for HUDs, minimaps, screen-space
  effects (Ch 9).
- **TileMap** — grid-based 2D world via a `TileSetAtlasSource` (Ch 6).
- **Tween** — one-shot interpolator; chain via `.tween_property()` /
  `.tween_callback()` (Ch 10, 8).
- **uid://** — robust resource handle that survives renames (Ch 11).
- **`user://`** — per-user data directory (saves, configs) (Ch 5, 11).
- **Variant** — Godot's universal dynamic type; underlies every
  property (Ch 1, 3).
- **VoxelGI** — real-time voxelized global illumination (Ch 9).
- **WorldEnvironment** — node bound to a scene that drives background
  / fog / post-processing (Ch 9).
