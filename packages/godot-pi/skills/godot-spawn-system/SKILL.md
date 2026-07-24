---
name: godot-spawn-system
description: Godot 4 enemy spawn/wave system with spawn points, level-driven config, drops. Use when implementing waves, spawners, or loot drops.
---

# Godot 怪物生成系统

## 概述

怪物系统包含怪物生成、寻路 AI、状态机和掉落机制。采用等级驱动的波次生成，根据玩家等级动态调整怪物类型和生成概率。

## 1. 怪物类型

### 1.1 僵尸类型枚举

```gdscript
# 僵尸类型枚举
enum Type {
    Zombie,      # 普通僵尸
    AglieZombie, # 敏捷僵尸
    ZombieKing   # 僵尸王
}
```

### 1.2 怪物属性表

| 类型 | 血量 | 移动速度 | 特殊 |
|------|------|----------|------|
| Zombie | 100 | 100 | 默认类型 |
| AglieZombie | 100 | 150 | 更快的移动速度 |
| ZombieKing | 100 | 100 | 有血条显示，100% 掉落 |

## 2. 生成点系统

### 2.1 地图配置

```gdscript
# 战斗地图类，管理生成点
class_name FightMap
extends Node2D

@export_group("Zombie Generater Enable")
@export var up_enable: bool = false
@export var left_enable: bool = false
@export var right_enable: bool = false
@export var down_enable: bool = false

@export_group("Zombie Generater Markers")
@export var up_markers_container: Node2D
@export var left_markers_container: Node2D
@export var right_markers_container: Node2D
@export var down_markers_container: Node2D

func get_zombie_generater_markers() -> Array[Marker2D]:
    var result: Array[Marker2D] = []
    if up_enable:
        result.append_array(up_markers_container.get_children())
    if left_enable:
        result.append_array(left_markers_container.get_children())
    if right_enable:
        result.append_array(right_markers_container.get_children())
    if down_enable:
        result.append_array(down_markers_container.get_children())
    return result
```

### 2.2 场景结构

```
FightMap
├── UpMarkers (Node2D)
│   └── Marker2D × N
├── LeftMarkers (Node2D)
│   └── Marker2D × N
├── RightMarkers (Node2D)
│   └── Marker2D × N
└── DownMarkers (Node2D)
    └── Marker2D × N
```

## 3. 生成波次机制

### 3.1 基于等级的生成配置

```gdscript
var generate_zombie_with_level = [
    {"zombie": 0.75, "king": 0.5, "king_time": 16},
    {"zombie": 0.30, "king": 1, "king_time": 5},  # 25级：僵尸王必出
]
```

| 字段 | 说明 |
|------|------|
| `zombie` | 普通僵尸生成概率（1 - zombie = 敏捷僵尸概率） |
| `king` | 僵尸王生成概率权重 |
| `king_time` | 僵尸王生成间隔（秒） |

## 4. 生成逻辑

### 4.1 定时器生成

```gdscript
func _on_generate_zombie_timer_timeout():
    if not zombie_generate_enable:
        return

    var zombie_markers = current_fight_map.get_zombie_generater_markers()
    var rand_zombie: float = randf()

    if can_generate_zombie_king and rand_zombie < GameData.generate_zombie_with_level[GameData.level].king:
        can_generate_zombie_king = false
        generate_zombie_king_timer.wait_time = GameData.generate_zombie_with_level[GameData.level].king_time
        generate_zombie_king_timer.start()
        zombie_packed_scene = ZOMBIE_KING
        fight_ui.warn_zombie_king()
    else:
        rand_zombie = randf()
        if rand_zombie < GameData.generate_zombie_with_level[GameData.level].zombie:
            zombie_packed_scene = ZOMBIE
        else:
            zombie_packed_scene = AGILE_ZOMBIE

    var zombie: Zombie = zombie_packed_scene.instantiate()
    zombie.global_position = zombie_markers.pick_random().global_position + random_pos
    zombie.died.connect(on_zombie_died)
    enermies.add_child(zombie)
```

## 5. 僵尸 AI 寻路

### 5.1 导航寻路

```gdscript
func _physics_process(_delta):
    if not is_died and not is_stun:
        var player := get_tree().get_first_node_in_group("Player") as Player
        navigation_agent_2d.target_position = player.global_position
        var next_pos = navigation_agent_2d.get_next_path_position()
        var new_velocity = global_position.direction_to(next_pos) * SPEED
        navigation_agent_2d.set_velocity(new_velocity)
        await navigation_agent_2d.velocity_computed
        move_and_slide()
```

### 5.2 状态机

```gdscript
enum State {
    Walk,   # 行走
    Stun,   # 眩晕
    Die     # 死亡
}

func die():
    animation_tree_state_machine.travel("Die")
    state_machine.change_state("Die")
    died.emit(type, global_position)
```

## 6. 死亡和掉落系统

### 6.1 掉落率配置

```gdscript
var zombie_drop_bullet_gift = {
    "zombie": 0.05,        # 普通僵尸：5% 掉落
    "aglie_zombie": 0.2,   # 敏捷僵尸：20% 掉落
    "zombie_king": 1       # 僵尸王：100% 掉落
}
```

## 7. 设计模式分析

| 模式 | 应用场景 |
|------|----------|
| **观察者模式** | 僵尸死亡通过 `died` 信号通知 |
| **状态机模式** | 僵尸使用 `StateMachine` 处理状态 |
| **对象池模式** | 通过 `instantiate()` 复用僵尸场景 |
| **导航系统** | 使用 `NavigationAgent2D` 实现自动寻路 |
| **工厂模式** | 根据概率和等级动态选择僵尸类型 |
