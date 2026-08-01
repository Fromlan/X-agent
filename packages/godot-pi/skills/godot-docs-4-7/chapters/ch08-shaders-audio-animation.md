# Chapter 8: Shaders, Audio, Animation

> Source: `Shaders` / `Audio` / `Animation` spines

## Core Idea
Three sibling subsystems that escalate a game from "functioning" to
"polished": **shaders** for visuals, **audio** for sound, **animation**
for time-varying behavior. Godot treats all three as **inspector-driven
Resources** with a small dedicated scripting layer.

## Frameworks Introduced
- **Godot Shading Language** (`shader_type` `canvas_item | spatial | sky
  | fog`) — custom 2D, 3D, sky, or fog rendering code; written in `.gdshader`
  files linked to a `ShaderMaterial`.
  - When to use: stylized look, water, outline, dissolve, parallax mapping.
  - How: declare uniform fields (`uniform float speed : hint_range(0, 5)`);
    write `vertex()` and `fragment()` functions.
- **Audio buses** (`AudioBusLayout`) — separate mixer buses for music,
  SFX, voice. Per-bus volume / EQ / reverb sends. `AudioStreamPlayer`
  plays into "Master" by default; you can swap bus.
- **`AnimationPlayer` + `AnimationTree`** — `AnimationPlayer` plays
  timelines; `AnimationTree` blends between timelines (state machines in
  `AnimationNodeStateMachine`, transitions in `AnimationNodeStateMachineTransition`).

## Key Concepts
- **Particle processes** (`GPUParticles2D` / `GPUParticles3D`) — emit
  sprites via shader or built-in `process_material`.
- **AudioStreamPlayer` is fire-and-forget;** `AudioStreamPlayer2D/3D`
  positions sound in space.
- **`Tween`** for procedural interpolation (camera shake, UI hover scale).
- **`AnimationPlayer.call_deferred("play", "name")`** — schedules
  animations after the current frame.

## Code Examples
```glsl
# water.gdshader — simple 2D wave
shader_type canvas_item;

uniform float speed : hint_range(0.0, 10.0) = 1.5;
uniform float height : hint_range(0.0, 0.1) = 0.04;

void vertex() {
    UV.y += sin(UV.x * 20.0 + TIME * speed) * height;
}
```
```gdscript
# ui_hover.gd — tween-driven scale on hover
@onready var button: Button = $"."

func _on_mouse_entered() -> void:
    var t := create_tween()
    t.tween_property(button, "scale", Vector2.ONE * 1.1, 0.15)

func _on_mouse_exited() -> void:
    create_tween().tween_property(button, "scale", Vector2.ONE, 0.15)
```
```gdscript
# audio bus + 3D positional sfx
@onready var step: AudioStreamPlayer3D = $Step
func _on_step() -> void:
    step.pitch_scale = randf_range(0.9, 1.1)
    step.play()
```
- **What it demonstrates**: a minimal vertex-displacement shader, Tween
  with `set_trans` (linear by default), `pitch_scale` randomization for
  procedural variety.

## Reference Tables
| Shader type | Used by |
|---|---|
| `canvas_item` | `Sprite2D`, `Control`, any 2D node |
| `spatial` | `MeshInstance3D`, `CSG*` |
| `sky` | `Sky` resource |
| `fog` | volumetric fog / `FogVolume` |

| Animation API | Use when |
|---|---|
| `Tween` | one-off interpolation |
| `AnimationPlayer` | explicit timeline playback |
| `AnimationTree` + StateMachine | blending / transitions between motions |
| `AnimationPlayer.play("name")` ad-hoc | quick scripted motion |
| `AnimatedSprite2D` | sprite-sheet flipbook |

| Audio API | Use when |
|---|---|
| `AudioStreamPlayer` | non-positional SFX / music |
| `AudioStreamPlayer2D / 3D` | positional sound |
| `AudioStreamOggVorbis / MP3 / Wav` | format pickers; OGG preferred |
| `AudioServer.add_bus()` | custom dynamic bus |
| `AudioEffect` resources | EQ / reverb / pitch-shift on a bus |

## Anti-patterns
- **Hard-coding `max()` shader math** — let `hint_range` document
  intent; clamp in code, not in eye.
- **Loading compressed audio (MP3) at runtime** — encode OGG at edit time
  for size; reserve MP3 for music licensing compatibility.
- **Looping AnimationPlayer playback in `_ready`** without checking save
  state — restoring the game jumps mid-cinematic.

## Key Takeaways
1. **Shaders are .gdshader + ShaderMaterial** — pick `shader_type` first.
2. **Bus layout = mix architecture.** Mute / duck on individual buses.
3. **AnimationTree with StateMachine** for char / creature behavior.

## Connects To
- **Ch 9 — Rendering**: shaders need the renderer chosen and `ProjectSettings.rendering`.
- **Ch 12 — Release pipeline**: OGG vs WAV matters for export size.
