# Patterns — Godot Recipes (4.7)

Concrete techniques repeated across the docs. Each pattern states when
to use it, the canonical shape, and the trade-off to watch.

## 1. Decouple with Signals, not with `get_node`
**When to use:** any time two nodes need to react to the same event
(button click, score, enemy died).

```gdscript
# emitter
signal died
func kill() -> void: died.emit()

# listener — anywhere
player.died.connect(_on_player_died)
```

**How:** declare the signal in the emitter's script (typed parameters
`signal died(cause: StringName)`); connect via editor's "Signals" panel
or `connect()` in code.
**Trade-off:** signals survive for the lifetime of either emitter or
listener; explicit `disconnect()` needed on long-lived singletons.

## 2. Composition over Inheritance: Node Trees, not Class Hierarchies
**When to use:** designing a player / enemy / interactive thing.

**How:** the *behavior* of an object is the nodes it contains, not the
class it extends. A "knockback enemy" is `CharacterBody3D + CollisionShape +
Area3D + AnimationPlayer + StateMachine`, **not** `extends BaseEnemy`.
**Trade-off:** scene-tree inspector gets long; save subtrees as
`PackedScene`s for reuse.

## 3. `@export` Everything that Designers Should Tune
**When to use:** any gameplay number a designer or playtester should
change without recompiling.

```gdscript
@export_range(50.0, 800.0) var speed: float = 220.0
@export var fire_scene: PackedScene
```

**How:** annotate with `@export`, optionally `@export_range`,
`@export_enum("Easy","Hard")`, `@export_resource("Material")`.
**Trade-off:** `@export` fields are loaded into Inspector —
don't `@export` things that should remain internal.

## 4. `@onready` for Child Node Caches
**When to use:** any persistent reference to a child that exists in the scene.

```gdscript
@onready var anim: AnimationPlayer = $AnimationPlayer
```

**How:** declare with `@onready`; resolves at `_ready()`, avoiding the
"null until added" pitfall.
**Trade-off:** rebuilding the child tree requires reconnecting; only use
for children declared in the same scene.

## 5. Action-based Input
**When to use:** for every input your game consumes.

```gdscript
# once, in _ready()
dir := Input.get_vector(&"move_left", &"move_right", &"move_up", &"move_down")
if Input.is_action_just_pressed(&"jump"): velocity.y = -jump
```

**How:** declare actions in `Project Settings → Input Map`. Bind
keys / mouse / gamepad to the same action.
**Trade-off:** the editor must be opened at least once to populate
`project.godot` with action keys; bind your defaults, then let players
rebind.

## 6. Optimistic Bundling — One Manager, Many Items
**When to use:** managing >10 enemies, items, particles.

**How:** a single autoload (`ObjectPool`) recycles instances; spawn /
despawn only on signals; `_process` updates one manager not 50 nodes.
**Trade-off:** slightly more code up front; pays off past ~100 entities.

## 7. Tween, not Property Driver
**When to use:** any one-off visual interpolation (UI hover scale,
camera shake, hit flash).

```gdscript
var t := create_tween()
t.tween_property(node, "modulate:a", 0.0, 0.4)
t.tween_callback(node.queue_free)
```

**How:** `create_tween()` then chain `.tween_property(...)` /
`.tween_callback(...)`; one tween holds the sequence.
**Trade-off:** tweens are tracked in time-domain; if you pause a
scene, all tweens pause; that's usually desired.

## 8. Collision Layers, not `if`-checks
**When to use:** any "this should collide with X but not Y" rule.

**How:** set `collision_layer` on the body (what I am) and
`collision_mask` (what I collide with). Use the 32-bit editor at the
top of every collision body.
**Trade-off:** bitfields are terse but easy to mis-set; document
naming once (`LAYER_PLAYER = 1 << 0`, etc.).

## 9. CharacterBody for Control, RigidBody for Simulation
**When to use:** deciding per body.

**How:** your player / NPC / boss is a `CharacterBody*`; physics-driven
crates, debris, ragdolls are `RigidBody*`.
**Trade-off:** `RigidBody` is non-deterministic across machines unless
you fix `physics_fps` and use deterministic integration; never host
multiplayer simulation in pure RigidBodies.

## 10. Resource as Data, Node as Logic
**When to use:** designer-tunable values across many entities.

```gdscript
class_name WeaponData extends Resource
@export var damage: int = 10
```

**How:** save as `.tres`; assign in inspector to a
`@export_resource("WeaponData") var weapon` on the entity.
**Trade-off:** Resources are serializable; Nodes aren't — but Resource
loading on press is also overhead, so reuse via `preload()`.

## 11. Typed Signals
**When to use:** every signal that crosses a module boundary.

```gdscript
signal hit(points: int, source: Node)
```

**How:** declare with parameter types; emit with `.emit()`. Connect
with typed `Callable`.
**Trade-off:** typed signals lose the loose-coupled promise of an
untyped Variant; that's the point (catching mistakes at editor-time).

## 12. Forward-Swap Renderer at Project Start
**When to use:** once, at project creation.

**How:** in `Project Settings → Rendering` set
`rendering/renderer/rendering_method` to `forward_plus`,
`mobile`, or `compatibility`. CLI: `--rendering-driver vulkan`.
**Trade-off:** switching later means new project files; lock it in.

## 13. `@rpc` for Any Cross-Player Logic
**When to use:** instead of raw byte streams.

```gdscript
@rpc("any_peer", "call_local", "reliable")
func chat(msg: String) -> void: ...
```

**How:** mark function; invoke via `chat.rpc(...)` or
`chat.rpc_id(id, ...)` to a specific peer.
**Trade-off:** serialization cost; for high-frequency state prefer
`MultiplayerSynchronizer` on properties.

## 14. Path2D / Path3D for Procedural Layouts
**When to use:** enemy spawns, camera rails, patrol routes.

**How:** design the `Curve` in editor; consume `progress_ratio` or
`progress` in code for parameterized positions.
**Trade-off:** curves are 2D / 3D points; for top-down 2D, a single
curve with `add_point(...)` covers it.

## 15. Persistence via `user://` + JSON
**When to use:** save files, settings, leaderboards.

```gdscript
const PATH := "user://save.json"
FileAccess.open(PATH, FileAccess.WRITE).store_string(JSON.stringify(d, "\t"))
```

**How:** write JSON with version and timestamp; never write to `res://`;
`FileAccess.file_exists` to gate load.
**Trade-off:** JSON is text; for >1 MB binary saves, consider
`FileAccess.store_var(...)` or a custom binary with a magic header.
