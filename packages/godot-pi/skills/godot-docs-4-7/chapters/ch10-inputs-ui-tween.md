# Chapter 10: Inputs, UI (Control), and Tween

> Source: `Inputs` / `GUI` / `UI` spines

## Core Idea
Godot's input layer is **action-based and multi-device out of the box**:
you define actions in Input Map, then ask for `Input.get_vector(...)` /
`is_action_pressed(...)`. UI is **scene-tree native** (`Control` nodes,
`Container` layouts, signals for clicks), not a separate widget toolkit.

## Frameworks Introduced
- **InputMap actions**: declare `"jump"` → bind space/UP/JoyButton-Y in
  editor, then read with `Input.is_action_just_pressed(&"jump")`.
- **`InputEvent*`**: typed events (`Key`, `MouseButton`, `JoypadButton`,
  `Magnitude4`...) — handle in `_unhandled_input(event)` for game logic.
- **`Control` layout containers**: `VBoxContainer`, `HBoxContainer`,
  `CenterContainer`, `MarginContainer`, `GridContainer` auto-arrange
  their children. Use `BoxContainer.size_flags_*` for stretch/shrink.
- **Nine-patch via `TextureButton`** and `AtlasTexture` for skins.
- **`Tween`** — procedural interpolation of any property.

## Key Concepts
- **`UI` control flow**: `_input` → `_gui_input` (for hovered `Control`)
  → `_unhandled_input`. Buttons + LineEdits consume events; if you click
  a button and don't see your `_unhandled_input` fire, that's why.
- **`FocusNeighbor`** — connect via `Control.focus_neighbor_*` for
  keyboard navigation between fields.
- **`Cursor`** — change via `Input.set_custom_mouse_cursor(image, 0,
  hot_spot)`.
- **`accept_dialog` / `confirmation_dialog`** — quick system dialogs.

## Code Examples
```gdscript
# input — typed, multi-device
const MOVE := [&"move_left", &"move_right", &"move_up", &"move_down"]

func _physics_process(_d: float) -> void:
    var dir := Input.get_vector(MOVE[1], MOVE[0], MOVE[3], MOVE[2])
    velocity = dir * speed
    move_and_slide()
```
```gdscript
# simple main menu
@onready var menu := $MainMenu as Control

func _ready() -> void:
    var start: Button = menu.find_child("Start")
    var quit: Button = menu.find_child("Quit")
    start.pressed.connect(_start_game)
    quit.pressed.connect(get_tree().quit)

func _start_game() -> void:
    var t := create_tween()
    t.tween_property(menu, "modulate:a", 0.0, 0.4)\
     .tween_callback(menu.queue_free)
    get_tree().change_scene_to_file("res://scenes/game.tscn")
```
```gdscript
# tween-based camera shake
func shake(intensity: float) -> void:
    var t := create_tween().set_loops(4)
    t.tween_property(camera, "offset", Vector2(randf(), randf()) * intensity, 0.04)
    t.tween_property(camera, "offset", Vector2(randf(), randf()) * intensity, 0.04)
    t.tween_property(camera, "offset", Vector2.ZERO, 0.1)
```
- **What it demonstrates**: `Input.get_vector` with `StringName[]`
  literal, finding children by name + signal-driven UI, "tween_callback"
  chain to chain a `queue_free` after fade.

## Reference Tables
| `Control` class | Use |
|---|---|
| `Button` / `TextureButton` / `CheckButton` | clickable |
| `LineEdit` / `TextEdit` | text input |
| `Label` / `RichTextLabel` | read-only; rich supports BBCode |
| `Panel` / `PanelContainer` | background |
| `VBox/HBox/Center/GridContainer` | auto layouts |
| `TabBar` / `TabContainer` | multi-page |
| `PopupMenu` | right-click menus |
| `ColorPicker` | color palette |

| Input API | Use |
|---|---|
| `InputMap.add_action(name)` | programmatic action registration |
| `Input.is_action_pressed(name)` | continuous (held) |
| `Input.is_action_just_pressed(name)` | edge — perfect for jump |
| `Input.get_vector(x_neg, x_pos, y_neg, y_pos, deadzone=0.2)` | 2-axis movement |
| `Input.get_axis(name1, name2)` | 1-axis (single stick / trigger) |

## Anti-patterns
- **Polling raw `Input.is_key_pressed(KEY_SPACE)`** — bypasses
  rebinding. Action-based is always better.
- **Manual `position` updates for labels** — let `Container`s do it.
- **`_unhandled_input` for UI clicks** — connect to `Button.pressed`
  instead.

## Key Takeaways
1. **Action-based input is the only sane approach** — even for single-device games.
2. **`Container`s handle 90% of layout**; manually align only art.
3. **`Tween` always over ad-hoc `_process`** for visual interpolation.

## Connects To
- **Ch 5 — Best practices**: InputMap is the rebind surface.
- **Ch 8 — Shaders/Audio/Animation**: UI lives in 2D shaders + Tweens.
