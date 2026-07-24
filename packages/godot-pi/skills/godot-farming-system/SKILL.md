---
name: godot-farming-system
description: Godot 4 farming/planting system with growth stages, watering, TileMap layers. Use when implementing crops, farm tiles, or plant lifecycles.
---

# Godot 种植系统设计

## 概述

种植系统采用事件驱动架构，通过全局信号实现地图逻辑与游戏逻辑的解耦，支持多种植物的种植、浇水和生长阶段管理。

## 1. 架构设计

### 1.1 分层架构

```
┌─────────────────────────────────────────┐
│         UI 层 (FarmUI)                   │
│  - 工具选择、植物种子选择                 │
├─────────────────────────────────────────┤
│         状态机层 (StateMachine)           │
│  - 玩家状态切换、工具使用状态             │
├─────────────────────────────────────────┤
│         逻辑层 (GlobalPlants)             │
│  - 植物数据管理、浇水状态、生命周期        │
├─────────────────────────────────────────┤
│         地图层 (TileMap)                  │
│  - GroundMap / EarthMap / PlantsMap      │
└─────────────────────────────────────────┘
```

### 1.2 核心信号

```gdscript
# globals/global_plants.gd
signal dig_earth(pos: Vector2)        # 挖掘土地信号
signal plant_plant(pos: Vector2)     # 种植植物信号
signal water_earth(pos: Vector2)     # 浇水土地信号
signal update_earth_map_tiles        # 更新泥土贴图信号
signal update_plants_map_life         # 更新植物生命周期信号
```

## 2. 数据层设计

### 2.1 植物数据结构

```gdscript
var plants = [
    {
        "name": "玉米",
        "source_id": 0,
        "life": [
            {
                "coord": Vector2i(0, 1),
                "require_time": 1
            },
            {
                "coord": Vector2i(1, 1),
                "require_time": 1
            },
        ]
    },
]
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | String | 植物名称 |
| `source_id` | int | 瓦片源ID |
| `life` | Array | 生长阶段数组 |
| `coord` | Vector2i | 精灵图坐标 |
| `require_time` | int | 该阶段所需时间（秒） |

### 2.2 浇水状态管理

```gdscript
var watered_pos: Array[Vector2i] = []

func on_water_earth(pos: Vector2):
    var water_pos = earth_map.local_to_map(ground_map.to_local(pos))
    if not GlobalPlants.watered_pos.has(water_pos):
        GlobalPlants.watered_pos.append(water_pos)
        GlobalPlants.update_earth_map_tiles.emit()
```

## 3. 地图层设计

### 3.1 三层 TileMap 结构

```
PlantMap (场景)
├── GroundMap   # 草地层（可挖掘的草地）
├── EarthMap    # 泥土层（挖掘后的土地）
└── PlantsMap   # 植物层（生长的植物）
```

### 3.2 植物地图逻辑

```gdscript
func on_dig_earth(pos: Vector2):
    var dig_pos = ground_map.local_to_map(ground_map.to_local(pos))
    var ground_tile_data = ground_map.get_cell_tile_data(GroundGrassLayer, dig_pos)

    if ground_tile_data == null:
        return

    var can_dig = ground_tile_data.get_custom_data("can_dig")
    if !can_dig:
        return

    var earth_tile_data = earth_map.get_cell_tile_data(EarthDirtLayer, dig_pos)
    if earth_tile_data != null:
        return

    earth_map.set_cells_terrain_connect(EarthDirtLayer, [dig_pos], 0, 0)

func on_plant_plant(pos: Vector2):
    var plant_pos = earth_map.local_to_map(ground_map.to_local(pos))
    var earth_tile_data = earth_map.get_cell_tile_data(EarthDirtLayer, plant_pos)
    var plant_tile_data = plants_map.get_cell_tile_data(PlantsLayer, plant_pos)

    if earth_tile_data == null or plant_tile_data != null:
        return

    var plant = GlobalPlants.plants[GlobalPlants.current_plant]
    plants_map.set_cell(PlantsLayer, plant_pos, plant.source_id, plant.life[0].coord)

    plant_tile_data = plants_map.get_cell_tile_data(PlantsLayer, plant_pos)
    plant_tile_data.set_custom_data("plant", GlobalPlants.current_plant)
    plant_tile_data.set_custom_data("life", 0)
    plant_tile_data.set_custom_data("require_time", plant.life[0]["require_time"])
```

## 4. 生长系统设计

### 4.1 植物生命周期更新

```gdscript
func on_update_plants_map_life():
    var used_rect = get_used_rect()
    for x in used_rect.size.x:
        for y in used_rect.size.y:
            var coord = Vector2i(x + used_rect.position.x, y + used_rect.position.y)

            if not GlobalPlants.watered_pos.has(coord):
                continue

            var tile_data = get_cell_tile_data(PlantLayer, coord)
            if tile_data == null:
                continue

            var plant_id = tile_data.get_custom_data("plant")
            var life = tile_data.get_custom_data("life")
            var require_time = tile_data.get_custom_data("require_time")

            require_time -= 1
            if require_time > 0:
                tile_data.set_custom_data("require_time", require_time)
                continue

            var plant = GlobalPlants.plants[plant_id]
            var plant_life = plant.life as Array
            life += 1

            if life < plant_life.size():
                var next_life = plant_life[life]
                set_cell(PlantLayer, coord, plant.source_id, next_life.coord)
                tile_data = get_cell_tile_data(PlantLayer, coord)
                tile_data.set_custom_data("require_time", next_life.require_time)
                tile_data.set_custom_data("life", life)
                tile_data.set_custom_data("plant", plant_id)
```

### 4.2 定时器循环

```gdscript
func plant_loop():
    await get_tree().create_timer(1).timeout
    update_plants_map_life.emit()
    plant_loop()
```

## 5. 泥土视觉效果

```gdscript
func _tile_data_runtime_update(_layer: int, coords: Vector2i, tile_data: TileData) -> void:
    if GlobalPlants.watered_pos.has(coords):
        tile_data.modulate = Color(.73, .58, .48, 1.0)
    else:
        tile_data.modulate = Color.WHITE
```

## 6. TileSet 自定义数据配置

| 自定义数据 | 所属层 | 说明 |
|-----------|--------|------|
| `can_dig` | GroundMap | 草地是否可挖掘 |
| `plant` | PlantsMap | 植物类型ID |
| `life` | PlantsMap | 当前生长阶段 |
| `require_time` | PlantsMap | 距离下一阶段所需时间 |

## 7. 种植流程图

```
┌─────────────┐     E键      ┌──────────────┐
│   Idle      │ ──────────>  │  UseTool     │
└─────────────┘              └──────┬───────┘
                                   │
                    ┌──────────────┴──────────────┐
                    │  GlobalTool.current_tool    │
                    └──────────────┬──────────────┘
         ┌─────────────────┬──────┴───────┬─────────────────┐
    "hoe" 挖掘         "kettle" 浇水    "seed" 种植         "axe" 劈砍
         │                 │              │                 │
         ▼                 ▼              ▼                 ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────────┐
│ dig_earth.emit  │ │ water_earth.emit│ │ plant_plant.emit    │
└────────┬────────┘ └────────┬────────┘ └──────────┬──────────┘
         │                  │                      │
         ▼                  ▼                      ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────────┐
│ 草地 → 泥土     │ │ 记录浇水位置    │ │ 泥土 → 植物         │
└─────────────────┘ └─────────────────┘ └─────────────────────┘
```
