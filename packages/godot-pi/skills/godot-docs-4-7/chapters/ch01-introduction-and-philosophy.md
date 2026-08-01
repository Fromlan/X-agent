# Chapter 1: Introduction & Godot's Design Philosophy

> Source: `Introduction` spine (Godot Docs 4.7 branch)

## Core Idea
Godot is an MIT-licensed, all-in-one game engine (2D + 3D + tooling) whose
**editor is itself a Godot game**. The engine's design philosophy is
composition over inheritance: build gameplay out of small nodes wired
together in a scene tree, not deep class hierarchies.

## Frameworks Introduced
- **Scene/Node/Scene-tree composition**: every game entity is a tree of
  `Node` objects packed into a `Scene`. Reuse = save a subtree as `.tscn`
  and `instantiate()` it.
  - When to use: any game object the player sees, hears, or interacts with.
  - How: pick a root `Node` subtype (`Node2D` / `Node3D` / `Control`),
    add children, save the root as a scene.
- **Signal-based decoupling**: nodes emit named signals; other nodes
  `connect` to them. No observer boilerplate, no global event bus.
  - When to use: cross-node reactions (button pressed, character died, item picked up).
  - How: declare `signal name(args)`; emit with `name.emit(...)`; connect
    via editor or `node.name.connect(callable)`.
- **All-inclusive package**: editor, scripting (GDScript / C# / GDScript-nim
  via extension), debugging, exporter, and asset pipeline live in one binary;
  no external tooling assembly required.
  - When to use: always — Godot prefers in-editor workflows over external scripts.

## Key Concepts
- **Project** — folder with `project.godot`; one game per project.
- **Scene (.tscn)** — serialized `Node` tree, the unit of reuse and instancing.
- **Resource** — reusable data asset (texture, audio, material, theme);
  loadable via `preload()` (compile-time) or `load()` (runtime).
- **Signal** — typed event bus baked into `Object`.
- **Variant** — Godot's universal dynamic type; every property holds one.
- **ClassDB / Class reference** — runtime class catalog; classes are
  introspectable (`ClassDB.class_get_property_list(node)` etc.).

## Mental Models
- Think of **the editor as a Godot scene**: UI panels are nodes; the dock
  layout is a tree of `Control`s you can extend with `EditorPlugin`.
- Think of a **scene tree as a directory**: parents own children, transform
  propagates downward, and you can `_ready()` a whole subtree the moment the
  parent enters.
- Think of **GDScript as "Python written by Godot"**: same indentation, but
  with a static type-checker (`@warning_ignore`, `: Type` annotations).

## Anti-patterns
- **Deep inheritance via `extends`** — Godot prefers composition. Don't
  override `Node` 5 levels deep when a scene with child nodes does the job.
- **Global singletons as a substitute for signals** — bad coupling; use
  autoloads only for truly cross-cutting state (audio bus manager, save manager).
- **Hard-coding paths to resources at runtime** — always `preload()` or
  `load()` an explicit `res://` URI; never assume CWD.
- **Treating GDScript like C#** — Variant semantics let you skip casts that
  C# needs; lean on the type checker instead of `Object` casts everywhere.

## Code Examples
```gdscript
# signals.gd — emits + listens in the same scene
extends Node2D
signal scored(points: int)

func hit() -> void:
    scored.emit(10)
```
```gdscript
# main.gd — connecting in code
@onready var player := $Player
func _ready() -> void:
    player.scored.connect(_on_scored)

func _on_scored(p: int) -> void:
    print("score: ", p)
```
- **What it demonstrates**: typed signal emission (`scored(points: int)`)
  and the `@onready` shorthand that resolves `$Player` once the node is in the tree.

## Key Takeaways
1. **Build with scenes, not classes.** Save subtrees as `.tscn`, instance them.
2. **Decouple with signals.** Don't `get_node("/root/Main/Player")` from a sibling.
3. **Pick a primary language** (GDScript for fast iteration, C# for type
   safety / .NET ecosystem) — but the engine is the same.
4. **Use the editor's embedded class reference** (`Search → Class`) — it's
   the canonical API source and matches the build you have.

## Connects To
- **Ch 2 — Step-by-step**: every tutorial here instantiates the same
  scene + signal pattern.
- **Ch 3 — GDScript overview**: signals + Variant typing are the
  foundation of the script API.
