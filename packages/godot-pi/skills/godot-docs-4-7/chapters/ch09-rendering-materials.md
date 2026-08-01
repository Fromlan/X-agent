# Chapter 9: Rendering, Materials & Lighting

> Source: `Rendering` / `Materials` / `Light & Shadow` / `Environment` spines

## Core Idea
Godot's renderer is **data-driven**: every visual property lives in a
`Resource` (material, sky, environment, light, fog volume, SSR settings)
inspectable in real time. Understanding the render pipeline hierarchy —
`Camera → WorldEnvironment → Sky → VoxelGI / SDFGI / Lightmaps → Mesh →
MeshInstance3D → Material` — is what makes both 2D and 3D scenes look
correct.

## Frameworks Introduced
- **Render layers (2D)**: `CanvasLayer.z_index` and `light_mask` for
  per-layer 2D lighting.
- **`WorldEnvironment`**: one node per scene; controls sky, ambient,
  glow, fog, SSAO, SSR, adjustment.
- **Global illumination**: `VoxelGI` (real-time), `LightmapGI` (baked),
  `SDFGI` (Forward+ only, sign-distance GI).
- **`MeshInstance3D` + LOD**: `geometry/visibility_range` fields activate
  mesh swapping at distance, `geometry/instance_lod` for scripted LOD.
- **`SubViewport` / `CompositorEffect`** — render targets for HUDs,
  minimaps, screen-space effects, runtime depth-of-field.

## Key Concepts
- **`Camera3D.cull_mask`** — bitfield filters which `visual_layer`
  objects the camera renders.
- **`MeshInstance3D.gi_mode`** — one of `STATIC`, `DYNAMIC`, `LIGHTMAPPED`,
  `NONE`; mismatched modes are a top cause of "darkness in static
  rooms".
- **`MeshInstance3D.material_overlay`** — split-second runtime debug
  material (great for hit-flash).
- **`ReflectedLight`**, **`Forward+ 2D / 3D`** — procedural on the GPU.

## Code Examples
```gdscript
# runtime WorldEnvironment swap
@onready var world_env: WorldEnvironment = $WorldEnvironment
@export var night_env: Environment
@export var day_env: Environment

func to_night() -> void:
    var t := create_tween()
    t.tween_property(world_env.environment, "background_sky_top_color",
        Color(0.05, 0.05, 0.1), 2.0)
```
```gdscript
# create a runtime SubViewport for minimap
@onready var mini: SubViewport = $Minimap
@onready var cam: Camera3D = $Minimap/Camera3D

func _process(_d: float) -> void:
    cam.global_position = player.global_position + Vector3.UP * 40
    cam.look_at(player.global_position, Vector3.UP)
```
```gdscript
# material override flash on hit
@onready var mesh := $Hero/MeshInstance3D
var default_mat: Material

func _ready() -> void:
    default_mat = mesh.get_active_material(0)

func hit() -> void:
    mesh.set_instance_shader_parameter("hit_strength", 1.0)
    var t := create_tween().set_loops(1)
    t.tween_property(mesh, "instance_shader_parameters/hit_strength",
        0.0, 0.3).from(1.0)
```
- **What it demonstrates**: tween'd environment change, runtime `SubViewport`,
  `instance_shader_parameter` for "shader pulses" without a second
  material swap.

## Reference Tables
| Resource | Purpose |
|---|---|
| `Material` (base) | abstract shader or StandardMaterial |
| `StandardMaterial3D` | PBR (metalness/roughness) base |
| `ORMMaterial3D` | packed Occlusion/Roughness/Metallic |
| `ProceduralSkyMaterial` | skybox via shader-like params |
| `FogVolume` | volumetric fog box |
| `VoxelGI` | voxelized GI |
| `LightmapGI` | baked GI |
| `CameraAttributes` | exposure / DOF override |

| `gi_mode` | Use |
|---|---|
| `STATIC` | baked LightmapGI |
| `DYNAMIC` | VoxelGI / SDFGI |
| `LIGHTMAPPED` | lightmap + dynamic lights |
| `NONE` | no GI |

## Anti-patterns
- **5+ `VoxelGI` nodes per scene** — each rebuild costs; budget to one.
- **Mixing Forward+ and Compatibility project settings** (then shipping
  to mobile) — set the renderer before shipping.
- **`Camera3D.fov = 0`** — clipping issues; verify `near = 0.05`,
  `far = 4000`.

## Key Takeaways
1. **`WorldEnvironment` is your render config UI** in code.
2. **Pick the GI strategy per-project** and stick to it.
3. **LOD via `visibility_range` and `instance_lod` is the cheap win** for
   3D scenes with >1k instances.

## Connects To
- **Ch 7 — 3D**: choice of renderer happens at project creation.
- **Ch 8 — Shaders**: every material is a shader or a resource that uses one.
