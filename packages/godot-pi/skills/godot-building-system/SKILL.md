---
name: godot-building-system
description: Godot 4 building system with GridMap blocks, first-person raycast interaction. Use when implementing voxel/block placement, bridge building, or GridMap editing.
---

# Godot 建造系统实现

## 概述

基于 Godot 4 引擎的 3D 建造类游戏，核心玩法是玩家收集资源并使用方块建造桥梁到达目标地点。

## 1. GridMap 方块管理系统

### 1.1 方块操作核心

```gdscript
extends GridMap

signal put_success
signal get_success

func destroy_block(world_pos):
    var map_coords = local_to_map(world_pos)
    if get_cell_item(map_coords) != INVALID_CELL_ITEM:
        set_cell_item(map_coords, INVALID_CELL_ITEM)
        get_success.emit()
    audio_stream_player_3d.play()

func place_block(world_pos, block_id):
    var map_coords = local_to_map(world_pos)
    set_cell_item(map_coords, block_id)
    put_success.emit()
    audio_stream_player_3d.play()
```

### 1.2 GridMap 关键 API

| 方法 | 作用 |
|------|------|
| `local_to_map(world_pos)` | 将世界坐标转换为网格坐标 |
| `map_to_local(map_coords)` | 将网格坐标转换为世界坐标 |
| `set_cell_item(map_coords, item)` | 在指定网格位置放置方块 |
| `get_cell_item(map_coords)` | 获取指定位置的方块 ID |
| `INVALID_CELL_ITEM` | 表示该位置无方块 |

## 2. 玩家控制器

### 2.1 玩家场景结构

```
Player (CharacterBody3D)
├── CollisionShape3D
├── MeshInstance3D
├── Camera3D
│   ├── GetRayCast (RayCast3D) - 射线检测（用于获取/销毁方块）
│   └── PutRayCast (RayCast3D) - 射线检测（用于放置方块）
└── Runing (AudioStreamPlayer3D)
```

### 2.2 玩家控制核心

```gdscript
class_name Player
extends CharacterBody3D

@onready var camera_3d: Camera3D = $Camera3D
@onready var get_ray_cast: RayCast3D = $Camera3D/GetRayCast
@onready var put_ray_cast: RayCast3D = $Camera3D/PutRayCast

const SPEED = 16.0
const JUMP_VELOCITY = 12.0
const gravity = Vector3(0, -24, 0)

func _unhandled_input(event: InputEvent) -> void:
    if event is InputEventMouseMotion:
        rotation.y -= event.relative.x * sensitivity
        camera_3d.rotation.x -= event.relative.y * sensitivity
        camera_3d.rotation.x = clamp(camera_3d.rotation.x, deg_to_rad(-70), deg_to_rad(85))

func _physics_process(delta: float) -> void:
    if not is_on_floor():
        velocity += gravity * delta

    if Input.is_action_just_pressed("jump") and is_on_floor():
        velocity.y = JUMP_VELOCITY

    var input_dir := Input.get_vector("left", "right", "forward", "back")
    var direction := (transform.basis * Vector3(input_dir.x, 0, input_dir.y)).normalized()

    if direction:
        velocity.x = direction.x * SPEED
        velocity.z = direction.z * SPEED
    else:
        velocity.x = move_toward(velocity.x, 0, SPEED)
        velocity.z = move_toward(velocity.z, 0, SPEED)

    # 左键 - 放置方块
    if Input.is_action_just_pressed("left_click"):
        if put_ray_cast.is_colliding():
            put_block.emit(put_ray_cast.get_collision_point() + put_ray_cast.get_collision_normal())

    # 右键 - 销毁方块
    if Input.is_action_just_pressed("right_click"):
        if get_ray_cast.is_colliding():
            get_block.emit(get_ray_cast.get_collision_point() - get_ray_cast.get_collision_normal())

    move_and_slide()
```

### 2.3 射线检测配置

```gdscript
# GetRayCast - 检测 GridMap 层
[GetRayCast]
target_position = Vector3(0, 0, -10)
collision_mask = 2

# PutRayCast - 检测地面层和玩家层
[PutRayCast]
target_position = Vector3(0, 0, -10)
collision_mask = 3
```

## 3. 游戏世界管理器

### 3.1 游戏逻辑核心

```gdscript
extends Node3D

@onready var grid_map_2: GridMap = $GridMap2

var remaining_block = 5:
    set(val):
        remaining_block = val
        remaining_block_count.text = "剩余方块数量：" + str(val)

func handle_put_block(pos):
    if remaining_block <= 0:
        return
    grid_map_2.place_block(pos, 16)

func handle_get_block(pos):
    grid_map_2.destroy_block(pos)

func handle_put_seccess():
    remaining_block -= 1

func handle_get_seccess():
    remaining_block += 1
```

## 4. 坐标系统理解

```gdscript
# 世界坐标 -> 网格坐标
var map_pos = grid_map.local_to_map(world_pos)

# 网格坐标 -> 世界坐标（方块中心点）
var center_pos = grid_map.map_to_local(map_pos)
```

## 5. 放置/销毁逻辑

```gdscript
# 放置：在碰撞点 + 法线方向（让方块紧贴表面）
place_pos = collision_point + collision_normal

# 销毁：在碰撞点 - 法线方向（移除被点击的方块）
destroy_pos = collision_point - collision_normal
```

## 6. GridMap 双层设计

- `GridMap` (collision_layer=5) - 地形方块，射线检测层 2
- `GridMap2` (collision_layer=6) - 玩家放置的方块，射线检测层 3

这种设计确保玩家只能放置/销毁自己放置的方块，不能破坏地形。
