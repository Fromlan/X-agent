---
name: godot-shader-patterns
description: Godot 4 shader recipes (outline, dissolve, water, etc.) plus short language basics. Use when writing canvas_item or spatial shaders for common VFX.
---

# Shader patterns

Aligned with Godot 4.x shading language / shader types docs.

## Basics (short)

- Declare type on the first line. Common VFX types:
  - `shader_type canvas_item` — 2D
  - `shader_type spatial` — 3D
  - Also: `particles`, `sky`, `fog`, `texture_blit` when those systems need a custom shader
- Types: `float`, `vec2`/`vec3`/`vec4`, `mat4`, samplers; `uniform` for tweakables (prefer `.0` float literals).
- Global `TIME` — seconds since engine start; **affected by** `Engine.time_scale`, not by pause; rolls over (~3600s default). Need unscaled time → own global shader uniform updated each frame.
- Keep math in the `vertex()` / `fragment()` / `light()` function that owns the effect; use `varying` to pass vertex→fragment.
- Files: `.gdshader` (Godot 4).

## Recipes (implement from need)

- **Outline** — sample neighbors / grow alpha (2D); or inverted hull for 3D.
- **Dissolve** — noise threshold + edge color.
- **Water / wave** — UV distort with `TIME` + layered noise.
- **Pixelate** — quantize UVs.
- **Blur** — multi-tap samples (mind fill-rate on mobile).

Prefer one focused `.gdshader` + material params over mega-shaders.
