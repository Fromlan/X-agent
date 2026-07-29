---
name: godot-ecs-component
description: Godot 4 Entity/Component/Resource composition. Use when splitting gameplay into HealthComponent-style nodes or data Resources.
---

# ECS-style components

Godot is **scene-tree first** and has **no built-in ECS**. Prefer child `Node` components and `Resource` data. Use a third-party ECS only if the project already depends on one.

Also consider lighter types when nodes are overkill: `Resource` / `RefCounted` for serializable or shared data (*When and how to avoid using nodes for everything*).

## Pattern

- **Entity** — scene root (character, item).
- **Component** — child nodes such as `HealthComponent`, `HitboxComponent`… own behaviour + signals.
- **Resource** — tunable data (`WeaponStats`); `duplicate()` when instances need independent copies.

## Rules

- Components talk via signals or the entity facade — avoid deep cross-component `$` chains.
- Keep Resources free of live `Node` references when possible (Resources outlive scenes).
- Name files/folders `snake_case`; node names `PascalCase` (project organization style).
