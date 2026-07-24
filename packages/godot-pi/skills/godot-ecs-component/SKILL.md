---
name: godot-ecs-component
description: Godot 4 ECS-style Entity/Component/Resource composition. Use when splitting gameplay into HealthComponent-style nodes or data Resources.
---

# Godot ECS 组件系统设计

## 概述

ECS（Entity Component System）是一种面向数据的架构模式，将游戏对象拆分为 Entity（实体）、Component（组件）和 System（系统）三个部分。在 Godot 中，我们通过组合 Node 和 Resource 实现 ECS 模式。

## 1. 架构设计

### 1.1 组件层级结构

```
┌─────────────────────────────────────────┐
│              Entity (Node)               │
│  - 角色节点、敌人节点、可交互对象          │
├─────────────────────────────────────────┤
│            Component (Node)              │
│  - HealthComponent、BuffComponent        │
│  - 可挂载到任意 Entity 上                 │
├─────────────────────────────────────────┤
│            Data (Resource)               │
│  - HealthData、WeaponData                │
│  - 可序列化、便于保存和复用               │
└─────────────────────────────────────────┘
```

### 1.2 核心组件示例

```gdscript
# health_component.gd
class_name HealthComponent
extends Node

signal health_changed(current: int, maximum: int)
signal damaged(amount: int, source: Node)
signal healed(amount: int)
signal died

@export var max_health: int = 100
@export var invincibility_time: float = 0.0

var current_health: int:
    set(value):
        var old := current_health
        current_health = clampi(value, 0, max_health)
        if current_health != old:
            health_changed.emit(current_health, max_health)

var _invincible: bool = false

func _ready() -> void:
    current_health = max_health

func take_damage(amount: int, source: Node = null) -> int:
    if _invincible or current_health <= 0:
        return 0

    var actual := mini(amount, current_health)
    current_health -= actual
    damaged.emit(actual, source)

    if current_health <= 0:
        died.emit()
    elif invincibility_time > 0:
        _start_invincibility()

    return actual

func heal(amount: int) -> int:
    var actual := mini(amount, max_health - current_health)
    current_health += actual
    if actual > 0:
        healed.emit(actual)
    return actual

func _start_invincibility() -> void:
    _invincible = true
    await get_tree().create_timer(invincibility_time).timeout
    _invincible = false
```

## 2. Hitbox 与 Hurtbox 系统

### 2.1 HitboxComponent

```gdscript
# hitbox_component.gd
class_name HitboxComponent
extends Area2D

signal hit(hurtbox: HurtboxComponent)

@export var damage: int = 10
@export var knockback_force: float = 200.0

var owner_node: Node

func _ready() -> void:
    owner_node = get_parent()
    area_entered.connect(_on_area_entered)

func _on_area_entered(area: Area2D) -> void:
    if area is HurtboxComponent:
        var hurtbox := area as HurtboxComponent
        if hurtbox.owner_node != owner_node:
            hit.emit(hurtbox)
            hurtbox.receive_hit(self)
```

### 2.2 HurtboxComponent

```gdscript
# hurtbox_component.gd
class_name HurtboxComponent
extends Area2D

signal hurt(hitbox: HitboxComponent)

@export var health_component: HealthComponent

var owner_node: Node

func _ready() -> void:
    owner_node = get_parent()

func receive_hit(hitbox: HitboxComponent) -> void:
    hurt.emit(hitbox)

    if health_component:
        health_component.take_damage(hitbox.damage, hitbox.owner_node)
```

## 3. 组件场景结构

```
Player (CharacterBody2D)
├── HealthComponent
│   └── (接收伤害，管理生命值)
├── HitboxComponent
│   └── (检测攻击，发送伤害)
├── HurtboxComponent
│   └── (接收伤害，触发健康组件)
├── BuffComponent
│   └── (管理增益/减益效果)
└── InventoryComponent
    └── (管理物品栏)
```

## 4. 组件设计原则

| 原则 | 说明 |
|------|------|
| **单一职责** | 每个组件只负责一个功能 |
| **松耦合** | 组件通过信号通信，不直接依赖 |
| **可复用** | 同一组件可挂载到不同实体 |
| **数据分离** | 数据存储在 Resource 中 |

## 5. 数据资源模式

```gdscript
# weapon_data.gd
class_name WeaponData
extends Resource

@export var name: StringName
@export var damage: int
@export var attack_speed: float
@export var range: float
@export_multiline var description: String
@export var icon: Texture2D
@export var projectile_scene: PackedScene
@export var sound_attack: AudioStream
```

```gdscript
# character_stats.gd
class_name CharacterStats
extends Resource

signal stat_changed(stat_name: StringName, new_value: float)

@export var max_health: float = 100.0
@export var attack: float = 10.0
@export var defense: float = 5.0
@export var speed: float = 200.0

var _current_health: float

func _init() -> void:
    _current_health = max_health

func get_current_health() -> float:
    return _current_health

func take_damage(amount: float) -> float:
    var actual_damage := maxf(amount - defense, 1.0)
    _current_health = maxf(_current_health - actual_damage, 0.0)
    stat_changed.emit("health", _current_health)
    return actual_damage

func duplicate_for_runtime() -> CharacterStats:
    var copy := duplicate() as CharacterStats
    copy._current_health = copy.max_health
    return copy
```

## 6. 设计模式总结

| 模式 | 应用场景 |
|------|----------|
| **组合模式** | Entity 通过组合组件构建 |
| **观察者模式** | 组件通过信号解耦通信 |
| **资源模式** | 数据存储在 Resource 中便于序列化 |
| **外观模式** | Entity 提供统一接口访问组件 |
