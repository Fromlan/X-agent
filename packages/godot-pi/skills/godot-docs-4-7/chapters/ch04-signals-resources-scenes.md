# Chapter 4: Signals, Resources & the Scene System

> Source: `Using signals` / `Resources` / `Scenes` spines

## Core Idea
Three concepts — **signals**, **resources**, and **scenes** — sit under
nearly every Godot pattern. Mastering them turns every other engine API
into a thin layer on top.

## Frameworks Introduced
- **Signal flow**: emitter → connection (1-to-many) → handler. Connections
  survive `free()` of either side until you `disconnect`; the editor's
  "Node → Signals" panel is the visual wiring tool.
  - When to use: cross-node reactions, UI events, gameplay events.
  - How: emit `name.emit(args)`; connect via
    `node.name.connect(callable, CONNECT_PERSIST | CONNECT_DEFERRED)`.
- **Resource as the universal data container**: every reusable
  asset — texture, sound, theme, material, script-derived config — is
  a `Resource` subclass with `.tres` save/load.
  - When to use: anything you'd save to disk and reuse, or expose
    to the Inspector.
  - How: `extends Resource`, `@export` fields, save via
    `ResourceSaver.save(res, "res://foo.tres")`.
- **Scene instancing as composition**: `PackedScene.instantiate()` returns
  a fresh tree. Owner nodes matter for "edit subscene in place" workflows.
  - When to use: any reusable game entity. **Default to scenes before
    falling back to scripts.**

## Key Concepts
- **`CONNECT_DEFERRED`** runs the handler at idle time (safe for
  modifying the scene tree from inside a loop).
- **`CONNECT_ONE_SHOT`** auto-disconnects after first emission.
- **`@export_resource("Texture2D")`** narrows an Inspector picker to a
  resource subtype.
- **`SceneTree.change_scene_to_packed(packed)`** swaps the current
  scene; the previous one is freed.

## Code Examples
```gdscript
# custom_signal.gd — emit a typed signal
extends Node
signal ready_to_spawn(spawn_id: StringName)

func _ready() -> void:
    await get_tree().create_timer(0.4).timeout
    ready_to_spawn.emit(&"player_1")
```
```gdscript
# connecting via code with CONNECT_PERSIST
@onready var button: Button = $UI/StartButton
func _ready() -> void:
    button.pressed.connect(_on_start_pressed,
        CONNECT_PERSIST | CONNECT_DEFERRED)
```
```gdscript
# resource: weapon data
class_name WeaponData extends Resource
@export var name: StringName = &"basic"
@export var damage: int = 10
@export var fire_rate: float = 0.2
```
- **What it demonstrates**: typed signals, persistent connections that
  survive `load()`, and `Resource` for designer-editable gameplay data.

## Reference Tables
| Signal connection flag | Effect |
|---|---|
| `CONNECT_PERSIST` | saved in the scene; reconnect on load |
| `CONNECT_DEFERRED` | run handler at idle, safe mid-iteration |
| `CONNECT_ONE_SHOT` | auto-disconnect after first fire |
| `CONNECT_REFERENCE_COUNTED` | tracked by `Callable` lifetime |

| Scene API | When |
|---|---|
| `PackedScene.pack(root)` | serialize a node tree to disk |
| `ResourceLoader.load(path)` | lazy load |
| `preload(path)` | parse-time load (faster, must exist) |
| `instantiate(edit_state)` | edit_state = `GEN_EDIT_STATE_INSTANCE` for editor |

## Anti-patterns
- **`get_node("/root/A/B/C")` everywhere** — fragile to refactors. Bind
  via `@onready` or absolute resource UIDs.
- **Mutable globals stored on the wrong layer** — non-saved values
  belong on `Node`, not `Resource`.
- **Forgetting `edit_state` on editor-instantiated `PackedScene`s** —
  leads to "Cannot edit this instance, it has no owner" warnings.

## Key Takeaways
1. **Signals are the universal decoupling layer** — even UI buttons are signals.
2. **Anything reusable is a `Resource`** — turn designer-facing data
   into `.tres` files.
3. **Default to scenes**; only fall back to programmatic nodes when
   flexibility requires it.

## Connects To
- **Ch 3 — GDScript**: signals + `@export` + `@onready` are the GDScript
  face of all three concepts.
- **Ch 5 — Best practices**: "object composition" pattern is exactly
  scene + node + signal.
