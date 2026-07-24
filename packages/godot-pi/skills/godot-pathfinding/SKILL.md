---
name: godot-pathfinding
description: Godot TileMap pathfinding: BFS, hex grids, path reconstruction, flow fields. Use when implementing grid/RTS/tower-defense AI movement on TileMaps.
---

# Godot TileMap 寻路系统

TileMap网格寻路实现，包含BFS扩散算法、六边形网格支持、路径追溯以及流场寻路功能。

## 何时使用此技能

- 需要为格子地图实现寻路功能
- 实现RTS、塔防、回合制策略等游戏
- 需要动态障碍物避让
- 需要流场寻路支持多单位导航

## 1. TileMap BFS 寻路实现

### 基础 BFS 扩散算法

```gdscript
# tile_map_bfs.gd
# TileMap网格BFS寻路实现
class_name TileMapBFS
extends Node2D

signal path_found(path: Array[Vector2i])
signal path_not_found

@export var tile_map: TileMap
@export var obstacles_layer: int = 0  # 障碍物所在的层

var _grid_size: Vector2i
var _walkable: Dictionary = {}  # {Vector2i: bool}

func _ready() -> void:
    if tile_map:
        _initialize_grid()

func _initialize_grid() -> void:
    _grid_size = tile_map.get_used_rect().size
    var origin := tile_map.get_used_rect().position

    for x in range(_grid_size.x):
        for y in range(_grid_size.y):
            var cell := Vector2i(origin.x + x, origin.y + y)
            var tile_data := tile_map.get_cell_tile_data(obstacles_layer, cell)
            _walkable[cell] = tile_data == null or not tile_data.get_custom_data("obstacle")

func find_path(start: Vector2i, end: Vector2i) -> Array[Vector2i]:
    if not _walkable.has(start) or not _walkable.has(end):
        return []

    if not _walkable.get(end, false):
        return []

    if start == end:
        return [start]

    var open_set: Array[Vector2i] = [start]
    var came_from: Dictionary = {}
    var visited: Dictionary = {start: true}

    while not open_set.is_empty():
        var current := open_set.pop_front()

        if current == end:
            return _reconstruct_path(came_from, current)

        for neighbor in _get_neighbors(current):
            if not visited.get(neighbor, false) and _walkable.get(neighbor, false):
                visited[neighbor] = true
                came_from[neighbor] = current
                open_set.append(neighbor)

    return []

func _get_neighbors(cell: Vector2i) -> Array[Vector2i]:
    return [
        cell + Vector2i(0, -1),  # 上
        cell + Vector2i(1, 0),   # 右
        cell + Vector2i(0, 1),   # 下
        cell + Vector2i(-1, 0),  # 左
    ]

func _reconstruct_path(came_from: Dictionary, current: Vector2i) -> Array[Vector2i]:
    var path: Array[Vector2i] = [current]

    while came_from.has(current):
        current = came_from[current]
        path.push_front(current)

    return path

func is_walkable(cell: Vector2i) -> bool:
    return _walkable.get(cell, false)

func set_obstacle(cell: Vector2i, obstacle: bool) -> void:
    _walkable[cell] = not obstacle
```

### 带权重的 BFS（用于斜向移动）

```gdscript
# weighted_bfs.gd
class_name WeightedBFS
extends Node

@export var tile_map: TileMap
@export var obstacles_layer: int = 0

var _cell_cost: Dictionary = {}  # 每个格子的移动成本

func _ready() -> void:
    _initialize_costs()

func _initialize_costs() -> void:
    var rect := tile_map.get_used_rect()
    for cell in tile_map.get_used_cells(obstacles_layer):
        var tile_data := tile_map.get_cell_tile_data(obstacles_layer, cell)
        if tile_data:
            _cell_cost[cell] = tile_data.get_custom_data("cost")
        else:
            _cell_cost[cell] = 1.0

func find_path(start: Vector2i, end: Vector2i) -> Array[Vector2i]:
    if start == end:
        return [start]

    var open_set: Array[Vector2i] = [start]
    var came_from: Dictionary = {}
    var cost_so_far: Dictionary = {start: 0.0}
    var visited: Dictionary = {}

    while not open_set.is_empty():
        open_set.sort_custom(func(a, b): return cost_so_far[a] < cost_so_far[b])
        var current := open_set.pop_front()

        if current == end:
            return _reconstruct_path(came_from, current)

        visited[current] = true

        for neighbor in _get_neighbors(current):
            if visited.get(neighbor, false):
                continue

            var move_cost := _get_move_cost(current, neighbor)
            var new_cost := cost_so_far[current] + move_cost

            if not cost_so_far.has(neighbor) or new_cost < cost_so_far[neighbor]:
                cost_so_far[neighbor] = new_cost
                came_from[neighbor] = current

                if not open_set.has(neighbor):
                    open_set.append(neighbor)

    return []

func _get_neighbors(cell: Vector2i) -> Array[Vector2i]:
    return [
        cell + Vector2i(0, -1),
        cell + Vector2i(1, 0),
        cell + Vector2i(0, 1),
        cell + Vector2i(-1, 0),
        cell + Vector2i(1, -1),  # 斜向
        cell + Vector2i(1, 1),
        cell + Vector2i(-1, 1),
        cell + Vector2i(-1, -1),
    ]

func _get_move_cost(from: Vector2i, to: Vector2i) -> float:
    var base_cost := _cell_cost.get(to, 1.0)

    # 斜向移动成本更高
    if from.x != to.x and from.y != to.y:
        return base_cost * 1.414  # sqrt(2)

    return base_cost

func _reconstruct_path(came_from: Dictionary, current: Vector2i) -> Array[Vector2i]:
    var path: Array[Vector2i] = [current]

    while came_from.has(current):
        current = came_from[current]
        path.push_front(current)

    return path
```

## 2. 六边形网格寻路

### 六边形网格坐标系统

```gdscript
# hexagon_pathfinding.gd
class_name HexagonPathfinding
extends Node

# 六边形网格偏移系统
enum OffsetSystem { POINTY_TOP, FLAT_TOP }
enum CoordinateSystem { CUBE, AXIAL, OFFSET }

@export var offset_system: OffsetSystem = OffsetSystem.POINTY_TOP
@export var tile_map: TileMap
@export var obstacles_layer: int = 0

var _cube_directions := [
    Vector3i(1, -1, 0), Vector3i(1, 0, -1), Vector3i(0, 1, -1),
    Vector3i(-1, 1, 0), Vector3i(-1, 0, 1), Vector3i(0, -1, 1)
]

func axial_to_cube(hex: Vector2i) -> Vector3i:
    return Vector3i(hex.x, hex.y, -hex.x - hex.y)

func cube_to_axial(cube: Vector3i) -> Vector2i:
    return Vector2i(cube.x, cube.y)

func offset_to_axial(offset: Vector2i) -> Vector2i:
    if offset_system == OffsetSystem.POINTY_TOP:
        return Vector2i(offset.x, offset.y - (offset.x - (offset.x & 1)) / 2)
    else:
        return Vector2i(offset.x - (offset.y - (offset.y & 1)) / 2, offset.y)

func axial_to_offset(axial: Vector2i) -> Vector2i:
    if offset_system == OffsetSystem.POINTY_TOP:
        return Vector2i(axial.x, axial.y + (axial.x - (axial.x & 1)) / 2)
    else:
        return Vector2i(axial.x + (axial.y - (axial.y & 1)) / 2, axial.y)

func get_neighbors(hex: Vector2i) -> Array[Vector2i]:
    var axial := offset_to_axial(hex)
    var cube := axial_to_cube(axial)
    var neighbors: Array[Vector2i] = []

    for direction in _cube_directions:
        var neighbor_cube := cube + direction
        var neighbor_axial := cube_to_axial(neighbor_cube)
        var neighbor_offset := axial_to_offset(neighbor_axial)
        neighbors.append(neighbor_offset)

    return neighbors

func is_walkable(hex: Vector2i) -> bool:
    var tile_data := tile_map.get_cell_tile_data(obstacles_layer, hex)
    return tile_data == null or not tile_data.get_custom_data("obstacle")

func find_path(start: Vector2i, end: Vector2i) -> Array[Vector2i]:
    if start == end:
        return [start]

    if not is_walkable(end):
        return []

    var open_set: Array[Vector2i] = [start]
    var came_from: Dictionary = {}
    var visited: Dictionary = {start: true}

    while not open_set.is_empty():
        var current := open_set.pop_front()

        if current == end:
            return _reconstruct_path(came_from, current)

        for neighbor in get_neighbors(current):
            if not visited.get(neighbor, false) and is_walkable(neighbor):
                visited[neighbor] = true
                came_from[neighbor] = current
                open_set.append(neighbor)

    return []

func _reconstruct_path(came_from: Dictionary, current: Vector2i) -> Array[Vector2i]:
    var path: Array[Vector2i] = [current]

    while came_from.has(current):
        current = came_from[current]
        path.push_front(current)

    return path

# 计算两个六边形之间的距离
func distance(a: Vector2i, b: Vector2i) -> int:
    var cube_a := axial_to_cube(offset_to_axial(a))
    var cube_b := axial_to_cube(offset_to_axial(b))
    return maxi(
        maxi(abs(cube_a.x - cube_b.x), abs(cube_a.y - cube_b.y)),
        abs(cube_a.z - cube_b.z)
    )
```

## 3. 路径追溯与平滑

### 路径可视化与平滑

```gdscript
# path_follower.gd
class_name PathFollower
extends Node2D

@export var path_line: Line2D
@export var move_speed: float = 200.0

var current_path: Array[Vector2i] = []
var current_index: int = 0
var is_moving: bool = false

var target_position: Vector2

signal path_completed
signal position_changed(new_pos: Vector2)

func set_path(path: Array[Vector2i], grid_to_world: Callable) -> void:
    current_path = path
    current_index = 0
    is_moving = false

    if path.is_empty():
        return

    target_position = grid_to_world.call(path[0])
    position = target_position

func _physics_process(delta: float) -> void:
    if not is_moving or current_path.is_empty():
        return

    var world_pos := grid_to_world(current_path[current_index])
    var direction := (world_pos - position).normalized()
    var distance := (world_pos - position).length()

    if distance < 5.0:
        current_index += 1
        position_changed.emit(position)

        if current_index >= current_path.size():
            is_moving = false
            path_completed.emit()
    else:
        position += direction * move_speed * delta

func start_moving() -> void:
    is_moving = true

func stop_moving() -> void:
    is_moving = false

func grid_to_world(grid_pos: Vector2i) -> Vector2:
    return tile_map.map_to_local(grid_pos)

# 平滑路径（去除多余拐点）
func smooth_path(path: Array[Vector2i], line_of_sight: Callable) -> Array[Vector2i]:
    if path.size() <= 2:
        return path

    var smoothed: Array[Vector2i] = [path[0]]
    var current := 0

    while current < path.size() - 1:
        var furthest := current + 1

        for i in range(path.size() - 1, current, -1):
            if line_of_sight.call(path[current], path[i]):
                furthest = i
                break

        smoothed.append(path[furthest])
        current = furthest

    return smoothed
```

## 4. 流式寻路（Flow Field）

流场寻路是RTS游戏中常用的技术，所有单位共享同一个流场，实现自然的群体避让。

### 流场构建原理

```gdscript
# flow_field.gd
# 流场寻路实现
# 原理：
# 1. 从目标点向外BFS扩散，构建距离场
# 2. 每个格子记录到目标的最短距离
# 3. 流场方向指向距离递减最快的方向
# 4. 单位沿流场方向移动即可到达目标
class_name FlowField
extends Node2D

@export var tile_map: TileMap
@export var obstacles_layer: int = 0
@export var destination_layer: int = 1

var _grid_size: Vector2i
var _cell_size: Vector2i
var _distance_field: Dictionary = {}  # {Vector2i: float}
var _flow_field: Dictionary = {}       # {Vector2i: Vector2}
var _walkable: Dictionary = {}

var _use_diagonals: bool = true

signal field_ready

func _ready() -> void:
    if tile_map:
        _initialize()

func _initialize() -> void:
    var used_rect := tile_map.get_used_rect()
    _grid_size = used_rect.size
    _cell_size = tile_map.tile_set.tile_size

    _build_walkable_map(used_rect)

func _build_walkable_map(rect: Rect2i) -> void:
    for x in range(rect.size.x):
        for y in range(rect.size.y):
            var cell := Vector2i(rect.position.x + x, rect.position.y + y)
            var tile_data := tile_map.get_cell_tile_data(obstacles_layer, cell)
            _walkable[cell] = tile_data == null or not tile_data.get_custom_data("obstacle")

func build_field(destination: Vector2i) -> void:
    _distance_field.clear()
    _flow_field.clear()

    # 如果目标不可行走，从最近的可行走格子开始
    if not _walkable.get(destination, false):
        destination = _find_nearest_walkable(destination)
        if destination == Vector2i(-1, -1):
            return

    # BFS 扩散构建距离场
    var queue: Array[Vector2i] = [destination]
    _distance_field[destination] = 0.0

    while not queue.is_empty():
        var current := queue.pop_front()
        var current_dist := _distance_field[current]

        for neighbor in _get_neighbors(current):
            if not _walkable.get(neighbor, false):
                continue

            var new_dist := current_dist + _get_move_cost(current, neighbor)

            if not _distance_field.has(neighbor) or new_dist < _distance_field[neighbor]:
                _distance_field[neighbor] = new_dist
                queue.append(neighbor)

    # 构建流场
    for cell in _distance_field.keys():
        _flow_field[cell] = _calculate_flow_direction(cell)

    field_ready.emit()

func _find_nearest_walkable(target: Vector2i) -> Vector2i:
    var closest: Vector2i = Vector2i(-1, -1)
    var min_dist := INF

    for cell in _walkable.keys():
        if _walkable[cell]:
            var dist := (cell - target).length()
            if dist < min_dist:
                min_dist = dist
                closest = cell

    return closest

func _get_neighbors(cell: Vector2i) -> Array[Vector2i]:
    var neighbors: Array[Vector2i] = [
        cell + Vector2i(0, -1),
        cell + Vector2i(1, 0),
        cell + Vector2i(0, 1),
        cell + Vector2i(-1, 0),
    ]

    if _use_diagonals:
        neighbors.append_array([
            cell + Vector2i(1, -1),
            cell + Vector2i(1, 1),
            cell + Vector2i(-1, 1),
            cell + Vector2i(-1, -1),
        ])

    return neighbors

func _get_move_cost(from: Vector2i, to: Vector2i) -> float:
    # 斜向移动成本
    if from.x != to.x and from.y != to.y:
        return 1.414
    return 1.0

func _calculate_flow_direction(cell: Vector2i) -> Vector2:
    var neighbors := _get_neighbors(cell)
    var best_direction := Vector2.ZERO
    var lowest_distance := INF

    for neighbor in neighbors:
        if _distance_field.has(neighbor):
            var dist := _distance_field[neighbor]
            if dist < lowest_distance:
                lowest_distance = dist
                var dir := Vector2(neighbor - cell).normalized()
                best_direction = dir

    return best_direction

func get_flow_direction(cell: Vector2i) -> Vector2:
    if _flow_field.has(cell):
        return _flow_field[cell]
    return Vector2.ZERO

func get_distance(cell: Vector2i) -> float:
    return _distance_field.get(cell, INF)

# 移动单位沿流场方向
func move_along_flow(unit_position: Vector2, speed: float, delta: float) -> Vector2:
    var cell := tile_map.local_to_map(unit_position)
    var flow := get_flow_direction(cell)

    if flow.length() > 0.01:
        return unit_position + flow * speed * delta
    else:
        # 如果没有流向（不在流场中），尝试随机移动
        return unit_position + Vector2.RIGHT * speed * delta * 0.5
```

### 多个目标的流场

```gdscript
# multi_target_flow_field.gd
class_name MultiTargetFlowField
extends FlowField

var _target_cells: Array[Vector2i] = []

func add_target(cell: Vector2i) -> void:
    if not cell in _target_cells:
        _target_cells.append(cell)

func remove_target(cell: Vector2i) -> void:
    _target_cells.erase(cell)

func clear_targets() -> void:
    _target_cells.clear()

func build_field() -> void:
    if _target_cells.is_empty():
        return

    _distance_field.clear()
    _flow_field.clear()

    # 多目标BFS
    var queue: Array[Vector2i] = _target_cells.duplicate()
    var visited: Dictionary = {}

    for target in _target_cells:
        if _walkable.get(target, false):
            _distance_field[target] = 0.0
            visited[target] = true

    while not queue.is_empty():
        var current := queue.pop_front()
        var current_dist := _distance_field[current]

        for neighbor in _get_neighbors(current):
            if not _walkable.get(neighbor, false):
                continue

            if visited.get(neighbor, false):
                continue

            visited[neighbor] = true
            _distance_field[neighbor] = current_dist + _get_move_cost(current, neighbor)
            queue.append(neighbor)

    # 构建流场
    for cell in _distance_field.keys():
        _flow_field[cell] = _calculate_flow_direction(cell)

    field_ready.emit()
```

## 5. 完整示例：RTS 单位寻路系统

```gdscript
# rts_unit_pathfinding.gd
# 完整的RTS单位寻路系统
class_name RTSUnitPathfinding
extends CharacterBody2D

@export var move_speed: float = 150.0
@export var flow_field: FlowField
@export var unit_radius: float = 16.0

var _current_target: Vector2i = Vector2i(-1, -1)
var _is_selected: bool = false
var _formation_offset: Vector2 = Vector2.ZERO

@onready var selection_indicator: Sprite2D = $SelectionIndicator
@onready var unit_sprite: Sprite2D = $Sprite2D

func _ready() -> void:
    selection_indicator.visible = false

func _physics_process(delta: float) -> void:
    if _current_target != Vector2i(-1, -1):
        _move_along_flow(delta)

func _move_along_flow(delta: float) -> void:
    var flow_dir := flow_field.get_flow_direction(global_position)

    if flow_dir.length() > 0.01:
        # 应用编队偏移
        var target_pos := global_position + flow_dir * move_speed * delta + _formation_offset * 0.1

        # 简单避让
        var avoidance := _calculate_avoidance()
        target_pos += avoidance * 50.0 * delta

        global_position = target_pos

        # 旋转朝向移动方向
        rotation = flow_dir.angle()
    else:
        # 到达目标
        _current_target = Vector2i(-1, -1)

func _calculate_avoidance() -> Vector2:
    var avoidance := Vector2.ZERO
    var nearby_units := get_tree().get_nodes_in_group("rts_units")

    for unit in nearby_units:
        if unit == self:
            continue

        var dist := global_position.distance_to(unit.global_position)
        if dist < unit_radius * 3:
            var push_dir := (global_position - unit.global_position).normalized()
            avoidance += push_dir * (1.0 - dist / (unit_radius * 3))

    return avoidance

func set_target(world_position: Vector2) -> void:
    _current_target = flow_field.tile_map.local_to_map(world_position)

func set_selected(selected: bool) -> void:
    _is_selected = selected
    selection_indicator.visible = selected

func set_formation_offset(offset: Vector2) -> void:
    _formation_offset = offset
```

## 性能优化建议

1. **缓存寻路结果**：对于相同起点的查询，直接返回缓存路径
2. **批量更新流场**：多个单位共享同一流场，避免重复计算
3. **分层寻路**：远距离使用粗糙网格，近距离使用精细网格
4. **异步计算**：复杂寻路在后台线程计算，避免阻塞主线程

## 最佳实践

- TileMap 障碍物使用自定义数据 `obstacle: true` 标记
- 流场适合大量单位同时寻路的场景
- 六边形网格适合策略游戏
- 路径平滑使用视线检测去除多余拐点
