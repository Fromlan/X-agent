---
name: godot-navigation-system
description: Godot 4 navigation: NavigationAgent2D/3D, AStarGrid2D, custom A*, flow fields, perf. Use when implementing AI pathfinding, dynamic obstacles, or NavLink setups.
---

# Godot 导航与寻路系统

Godot 4 导航系统完整指南，涵盖 NavigationAgent2D、AStarGrid2D、自定义 A* 算法、流场寻路及性能优化策略。

## 何时使用此技能

- 需要 NavigationServer2D/3D 导航系统
- 实现游戏AI寻路导航
- 需要动态障碍物和NavLink连接
- 优化大量单位的寻路性能

## 1. NavigationAgent2D 使用

NavigationAgent2D 是 Godot 4 推荐的 2D 导航解决方案，封装了 NavigationServer 的复杂操作。

### 基础设置

```gdscript
# navigation_agent_2d.gd
class_name NavigationAgent2D
extends NavigationAgent2D

signal navigation_finished
signal path_changed
signal target_reached

@export var actor: CharacterBody2D
@export var move_speed: float = 200.0

var _target_position: Vector2 = Vector2.ZERO

func _ready() -> void:
    # 设置代理半径（障碍物避让）
    agent_height = 0
    agent_max_speed = move_speed

    # 连接信号
    navigation_finished.connect(_on_navigation_finished)
    path_changed.connect(_on_path_changed)
    target_reached.connect(_on_target_reached)

    # 等待NavigationServer同步
    await get_tree().physics_frame
    await get_tree().physics_frame

func _physics_process(delta: float) -> void:
    if actor and _target_position != Vector2.ZERO:
        if is_navigation_finished():
            return

        var next_pos := get_next_path_position()
        var current_pos := actor.global_position
        var new_velocity := (next_pos - current_pos).normalized() * move_speed

        actor.velocity = new_velocity
        actor.move_and_slide()

func set_target(world_position: Vector2) -> void:
    _target_position = world_position
    target_position = world_position

func _on_navigation_finished() -> void:
    navigation_finished.emit()

func _on_path_changed() -> void:
    path_changed.emit()

func _on_target_reached() -> void:
    target_reached.emit()
```

### NavigationRegion2D 导航区域

```gdscript
# navigation_region.gd
class_name NavigationRegion
extends NavigationRegion2D

@export var tile_map: TileMap
@export var bake_on_ready: bool = true

func _ready() -> void:
    if bake_on_ready:
        await get_tree().physics_frame
        bake_navigation_polygon()

# 从 TileMap 几何数据生成导航多边形
func bake_from_tilemap() -> void:
    var polygon := NavigationPolygon.new()
    var outline: Array[Vector2] = []

    var used_rect := tile_map.get_used_rect()

    for x in range(used_rect.size.x):
        for y in range(used_rect.size.y):
            var cell := Vector2i(used_rect.position.x + x, used_rect.position.y + y)
            var tile_data := tile_map.get_cell_tile_data(0, cell)

            if tile_data and tile_data.get_custom_data("obstacle"):
                # 障碍物格子不加入导航
                continue

            var world_pos := tile_map.map_to_local(cell)
            outline.append(world_pos)

    if not outline.is_empty():
        polygon.add_outline(outline)
        polygon.make_polygons_from_outlines()

    navigation_polygon = polygon
    bake_navigation_polygon()
```

### 动态障碍物

```gdscript
# dynamic_obstacle.gd
class_name DynamicObstacle
extends Area2D

@export var radius: float = 32.0
@export var navigation_region: NavigationRegion

var _last_position: Vector2

func _ready() -> void:
    area_entered.connect(_on_area_entered)
    area_exited.connect(_on_area_exited)

func _physics_process(_delta: float) -> void:
    if global_position != _last_position:
        _last_position = global_position
        _update_navigation()

func _update_navigation() -> void:
    # 简单实现：移动时重新烘焙导航网格
    # 生产环境建议使用 NavigationMesh::update()
    if navigation_region:
        navigation_region.bake_navigation_polygon()

func _on_area_entered(area: Area2D) -> void:
    # 障碍物进入逻辑
    pass

func _on_area_exited(area: Area2D) -> void:
    # 障碍物离开逻辑
    pass
```

## 2. AStarGrid2D 算法实现

AStarGrid2D 是 Godot 4 内置的高效网格寻路组件，适合规则网格的快速 A* 搜索。

### 基础 AStarGrid2D

```gdscript
# astar_grid_2d.gd
class_name AStarGrid2D
extends Node

@export var tile_map: TileMap
@export var obstacles_layer: int = 0

var _grid: AStarGrid2D

func _ready() -> void:
    _setup_grid()

func _setup_grid() -> void:
    var region := tile_map.get_used_rect()

    _grid = AStarGrid2D.new()
    _grid.size = region.size
    _grid.offset = tile_map.tile_set.tile_size / 2
    _grid.cell_size = tile_map.tile_set.tile_size
    _grid.center = false
    _grid.diagonal_mode = AStarGrid2D.DIAGONAL_MODE_NEVER

    _grid.update()

    # 标记障碍物
    for cell in tile_map.get_used_cells(obstacles_layer):
        var tile_data := tile_map.get_cell_tile_data(obstacles_layer, cell)
        if tile_data and tile_data.get_custom_data("obstacle"):
            _grid.set_point_solid(cell - region.position)

func find_path(start: Vector2i, end: Vector2i) -> PackedVector2Array:
    var region := tile_map.get_used_rect()
    var local_start := start - region.position
    var local_end := end - region.position

    if not _grid.is_point_inside(local_start) or not _grid.is_point_inside(local_end):
        return PackedVector2Array()

    if _grid.is_point_solid(local_start) or _grid.is_point_solid(local_end):
        return PackedVector2Array()

    var path := _grid.get_point_path(local_start, local_end)

    # 转换回世界坐标
    var world_path := PackedVector2Array()
    for point in path:
        world_path.append(tile_map.map_to_local(point + region.position))

    return world_path

func is_walkable(cell: Vector2i) -> bool:
    var region := tile_map.get_used_rect()
    var local_cell := cell - region.position

    if not _grid.is_point_inside(local_cell):
        return false

    return not _grid.is_point_solid(local_cell)

func set_obstacle(cell: Vector2i, obstacle: bool) -> void:
    var region := tile_map.get_used_rect()
    var local_cell := cell - region.position

    if obstacle:
        _grid.set_point_solid(local_cell)
    else:
        _grid.clear_point(local_cell)
```

### 带权重的 AStarGrid2D

```gdscript
# weighted_astar_grid.gd
class_name WeightedAStarGrid
extends AStarGrid2D

var _cell_weights: Dictionary = {}

func _ready() -> void:
    _setup_grid()

func _setup_grid() -> void:
    var region := tile_map.get_used_rect()

    _grid = AStarGrid2D.new()
    _grid.size = region.size
    _grid.offset = tile_map.tile_set.tile_size / 2
    _grid.cell_size = tile_map.tile_set.tile_size
    _grid.center = false
    _grid.diagonal_mode = AStarGrid2D.DIAGONAL_MODE_ONLY_IF_NO_OBSTACLES

    _grid.update()

    # 初始化权重
    for x in range(region.size.x):
        for y in range(region.size.y):
            var cell := Vector2i(region.position.x + x, region.position.y + y)
            _initialize_cell_weight(cell)

    # 标记障碍物
    for cell in tile_map.get_used_cells(obstacles_layer):
        var tile_data := tile_map.get_cell_tile_data(obstacles_layer, cell)
        if tile_data and tile_data.get_custom_data("obstacle"):
            _grid.set_point_solid(cell - region.position)

func _initialize_cell_weight(cell: Vector2i) -> void:
    var tile_data := tile_map.get_cell_tile_data(obstacles_layer, cell)

    if tile_data:
        var weight := tile_data.get_custom_data("weight")
        if weight != null:
            _cell_weights[cell] = weight
        else:
            _cell_weights[cell] = 1.0
    else:
        _cell_weights[cell] = 1.0

func find_path(start: Vector2i, end: Vector2i) -> PackedVector2Array:
    # 使用默认的 A* 路径（权重需要在使用时自定义处理）
    return super.find_path(start, end)

# 估计成本（启发式函数）
func _estimate_cost(from: Vector2i, to: Vector2i) -> float:
    var weight := _cell_weights.get(to, 1.0)
    return (from - to).length() * weight
```

## 3. 自定义 A* 实现

### 标准 A* 算法

```gdscript
# custom_astar.gd
# 自定义 A* 寻路实现
class_name CustomAStar
extends Node

@export var tile_map: TileMap
@export var obstacles_layer: int = 0

var _grid_size: Vector2i
var _walkable: Dictionary = {}

class AStarNode:
    var cell: Vector2i
    var g_cost: float  # 从起点到当前节点的实际成本
    var h_cost: float  # 从当前节点到终点的估计成本
    var f_cost: float:  # g_cost + h_cost
        return g_cost + h_cost
    var parent: AStarNode = null

    func _init(c: Vector2i, g: float, h: float) -> void:
        cell = c
        g_cost = g
        h_cost = h

func _ready() -> void:
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
        # 目标不可达，寻找最近的可通行点
        end = _find_nearest_walkable(end)
        if end == Vector2i(-1, -1):
            return []

    var open_set: Array[AStarNode] = []
    var closed_set: Dictionary = {}

    var start_node := AStarNode.new(start, 0.0, _heuristic(start, end))
    open_set.append(start_node)

    while not open_set.is_empty():
        # 找到 f_cost 最低的节点
        open_set.sort_custom(func(a, b): return a.f_cost < b.f_cost)
        var current := open_set.pop_front()

        if current.cell == end:
            return _reconstruct_path(current)

        closed_set[current.cell] = current

        for neighbor in _get_neighbors(current.cell):
            if closed_set.has(neighbor) or not _walkable.get(neighbor, false):
                continue

            var g_cost := current.g_cost + _get_move_cost(current.cell, neighbor)
            var h_cost := _heuristic(neighbor, end)

            var existing := _find_in_open_set(open_set, neighbor)

            if existing == null:
                var new_node := AStarNode.new(neighbor, g_cost, h_cost)
                new_node.parent = current
                open_set.append(new_node)
            elif g_cost < existing.g_cost:
                existing.g_cost = g_cost
                existing.parent = current

    return []

func _find_in_open_set(open_set: Array[AStarNode], cell: Vector2i) -> AStarNode:
    for node in open_set:
        if node.cell == cell:
            return node
    return null

func _heuristic(a: Vector2i, b: Vector2i) -> float:
    # 曼哈顿距离
    return absf(a.x - b.x) + absf(a.y - b.y)

func _get_move_cost(from: Vector2i, to: Vector2i) -> float:
    # 斜向移动
    if from.x != to.x and from.y != to.y:
        return 1.414
    return 1.0

func _get_neighbors(cell: Vector2i) -> Array[Vector2i]:
    return [
        cell + Vector2i(0, -1),
        cell + Vector2i(1, 0),
        cell + Vector2i(0, 1),
        cell + Vector2i(-1, 0),
        cell + Vector2i(1, -1),
        cell + Vector2i(1, 1),
        cell + Vector2i(-1, 1),
        cell + Vector2i(-1, -1),
    ]

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

func _reconstruct_path(end_node: AStarNode) -> Array[Vector2i]:
    var path: Array[Vector2i] = []
    var current: AStarNode = end_node

    while current != null:
        path.push_front(current.cell)
        current = current.parent

    return path
```

## 4. 流式寻路（Flow Field Navigation）

流场寻路特别适合大量单位同时寻路的 RTS 游戏场景。

### NavigationServer 流场

```gdscript
# nav_flow_field.gd
# 使用 NavigationServer 实现流场
class_name NavFlowField
extends Node2D

@export var navigation_region: NavigationRegion2D
@export var tile_map: TileMap
@export var obstacles_layer: int = 0
@export var destination_layer: int = 1

var _nav_rid: RID
var _flow_map: Dictionary = {}  # Vector2i -> Vector2

var _update_needed: bool = false

func _ready() -> void:
    _nav_rid = navigation_region.navigation_rid
    _build_initial_flow_field()

func _physics_process(_delta: float) -> void:
    if _update_needed:
        _build_flow_field()
        _update_needed = false

func request_update() -> void:
    _update_needed = true

func _build_initial_flow_field() -> void:
    _build_flow_field()

func _build_flow_field() -> void:
    _flow_map.clear()

    # 获取所有可行走格子
    var walkable_cells: Array[Vector2i] = []
    var destination_cells: Array[Vector2i] = []

    for cell in tile_map.get_used_cells(0):
        var tile_data := tile_map.get_cell_tile_data(obstacles_layer, cell)
        if tile_data and tile_data.get_custom_data("obstacle"):
            continue
        walkable_cells.append(cell)

    for cell in tile_map.get_used_cells(destination_layer):
        destination_cells.append(cell)

    if destination_cells.is_empty():
        return

    # BFS 构建距离场
    var distance_field: Dictionary = {}
    var queue: Array[Vector2i] = destination_cells.duplicate()

    for dest in destination_cells:
        distance_field[dest] = 0.0

    while not queue.is_empty():
        var current := queue.pop_front()
        var current_dist := distance_field[current]

        for neighbor in _get_neighbors(current):
            if not _walkable(neighbor):
                continue

            if not distance_field.has(neighbor):
                distance_field[neighbor] = current_dist + 1.0
                queue.append(neighbor)

    # 构建流场
    for cell in distance_field.keys():
        _flow_map[cell] = _calculate_flow_direction(cell, distance_field)

func _walkable(cell: Vector2i) -> bool:
    var tile_data := tile_map.get_cell_tile_data(obstacles_layer, cell)
    return tile_data == null or not tile_data.get_custom_data("obstacle")

func _get_neighbors(cell: Vector2i) -> Array[Vector2i]:
    return [
        cell + Vector2i(0, -1),
        cell + Vector2i(1, 0),
        cell + Vector2i(0, 1),
        cell + Vector2i(-1, 0),
    ]

func _calculate_flow_direction(cell: Vector2i, distance_field: Dictionary) -> Vector2:
    var neighbors := _get_neighbors(cell)
    var best_dir := Vector2.ZERO
    var lowest_dist := INF

    for neighbor in neighbors:
        if distance_field.has(neighbor):
            var dist := distance_field[neighbor]
            if dist < lowest_dist:
                lowest_dist = dist
                best_dir = Vector2(neighbor - cell).normalized()

    return best_dir

func get_flow_direction(world_pos: Vector2) -> Vector2:
    var cell := tile_map.local_to_map(world_pos)

    if _flow_map.has(cell):
        return _flow_map[cell]

    return Vector2.ZERO
```

## 5. 性能优化

### 分组寻路（Pathfinding Batching）

```gdscript
# batched_pathfinding.gd
# 分组批量寻路，减少每帧计算量
class_name BatchedPathfinding
extends Node

signal batch_completed(paths: Dictionary)

@export var max_paths_per_frame: int = 5

var _pending_requests: Array[Dictionary] = []
var _completed_paths: Dictionary = {}
var _current_batch: int = 0

class PathRequest:
    var requester_id: int
    var start: Vector2i
    var end: Vector2i
    var priority: int

    func _init(id: int, s: Vector2i, e: Vector2i, p: int = 0) -> void:
        requester_id = id
        start = s
        end = e
        priority = p

func _physics_process(_delta: float) -> void:
    _process_batch()

func request_path(requester_id: int, start: Vector2i, end: Vector2i, priority: int = 0) -> void:
    _pending_requests.append(PathRequest.new(requester_id, start, end, priority))

func _process_batch() -> void:
    if _pending_requests.is_empty():
        return

    # 按优先级排序
    _pending_requests.sort_custom(func(a, b): return a.priority > b.priority)

    var processed: int = 0

    while not _pending_requests.is_empty() and processed < max_paths_per_frame:
        var request := _pending_requests.pop_front() as PathRequest
        var path := _calculate_path(request.start, request.end)

        _completed_paths[request.requester_id] = path
        processed += 1

    if _pending_requests.is_empty():
        batch_completed.emit(_completed_paths)
        _completed_paths.clear()

func _calculate_path(start: Vector2i, end: Vector2i) -> Array[Vector2i]:
    # 这里使用自定义的 A* 或其他寻路算法
    var astar: CustomAStar = $CustomAStar
    return astar.find_path(start, end)

func get_completed_path(requester_id: int) -> Array[Vector2i]:
    if _completed_paths.has(requester_id):
        return _completed_paths[requester_id]
    return []
```

### 节流寻路（Throttled Pathfinding）

```gdscript
# throttled_pathfinding.gd
# 节流寻路，避免频繁计算
class_name ThrottledPathfinding
extends Node

@export var throttle_duration: float = 0.2  # 秒

var _path_cache: Dictionary = {}
var _last_update_time: float = 0.0
var _pending_requests: Dictionary = {}
var _needs_update: bool = false

var _astar: CustomAStar

func _ready() -> void:
    _astar = $CustomAStar

func _physics_process(delta: float) -> void:
    if _needs_update:
        _last_update_time += delta

        if _last_update_time >= throttle_duration:
            _execute_throttled_update()
            _last_update_time = 0.0
            _needs_update = false

func request_path(id: int, start: Vector2i, end: Vector2i) -> void:
    _pending_requests[id] = {"start": start, "end": end, "path": null}
    _needs_update = true

func _execute_throttled_update() -> void:
    for id in _pending_requests.keys():
        var request := _pending_requests[id]
        var path := _astar.find_path(request.start, request.end)
        _path_cache[id] = path
        request.path = path

    _pending_requests.clear()

func get_path(id: int) -> Array[Vector2i]:
    return _path_cache.get(id, [])
```

### LOD 寻路（Level of Detail）

```gdscript
# lod_pathfinding.gd
# 分层寻路，远距离用粗糙网格
class_name LODPathfinding
extends Node

enum LODLevel { HIGH, MEDIUM, LOW }

@export var tile_map: TileMap
@export var obstacles_layer: int = 0

var _lod_grid_sizes: Dictionary = {
    LODLevel.HIGH: Vector2i(1, 1),
    LODLevel.MEDIUM: Vector2i(4, 4),
    LODLevel.LOW: Vector2i(8, 8),
}

var _lod_astar: Dictionary = {}

func _ready() -> void:
    _initialize_lod_grids()

func _initialize_lod_grids() -> void:
    for level in _lod_grid_sizes.keys():
        _create_lod_grid(level)

func _create_lod_grid(level: LODLevel) -> void:
    var grid_size := _lod_grid_sizes[level]
    var region := tile_map.get_used_rect()

    var astar := AStarGrid2D.new()
    var coarse_size := Vector2i(
        ceili(region.size.x / float(grid_size.x)),
        ceili(region.size.y / float(grid_size.y))
    )

    astar.size = coarse_size
    astar.cell_size = tile_map.tile_set.tile_size * grid_size
    astar.center = false
    astar.diagonal_mode = AStarGrid2D.DIAGONAL_MODE_NEVER
    astar.update()

    _lod_astar[level] = astar

func find_path(start: Vector2i, end: Vector2i) -> Array[Vector2i]:
    var distance := (start - end).length()

    var level: LODLevel
    if distance < 200:
        level = LODLevel.HIGH
    elif distance < 500:
        level = LODLevel.MEDIUM
    else:
        level = LODLevel.LOW

    return _find_path_at_level(start, end, level)

func _find_path_at_level(start: Vector2i, end: Vector2i, level: LODLevel) -> Array[Vector2i]:
    var astar: AStarGrid2D = _lod_astar[level]

    # 转换到 LOD 网格坐标
    var grid_size := _lod_grid_sizes[level]
    var region := tile_map.get_used_rect()

    var local_start := (start - region.position) / grid_size
    var local_end := (end - region.position) / grid_size

    if astar.is_point_inside(local_start) and astar.is_point_inside(local_end):
        return astar.get_point_path(local_start, local_end)

    return []
```

## 6. NavLink 连接

NavLink 用于连接不连续的导航区域，实现跳跃、传送等效果。

### 自定义 NavLink

```gdscript
# custom_nav_link.gd
class_name CustomNavLink
extends NavigationLink2D

@export var link_type: int = 0  # 0: 传送, 1: 跳跃, 2: 桥梁

var _is_active: bool = true

func _ready() -> void:
    navigation_layers = 1  # 设置导航层

func _get_navigation_links(start_position: Vector2, end_position: Vector2) -> Array[Vector2]:
    if not _is_active:
        return []

    return [start_position, end_position]

func set_active(active: bool) -> void:
    _is_active = active
```

### 使用 NavLink 实现跳跃

```gdscript
# platform_nav_link.gd
class_name PlatformNavLink
extends NavigationLink2D

@export var jump_height: float = 100.0
@export var jump_duration: float = 0.5

var _start_pos: Vector2
var _end_pos: Vector2

func _ready() -> void:
    var owner := get_parent()
    if owner is Node2D:
        _start_pos = owner.global_position
        _end_pos = global_position

func get_jump_path(start: Vector2, end: Vector2) -> PackedVector2Array:
    if not _is_enabled():
        return PackedVector2Array()

    var path := PackedVector2Array()
    path.append(start)

    # 抛物线中间点
    var mid_point := (start + end) / 2.0
    mid_point.y -= jump_height

    path.append(mid_point)
    path.append(end)

    return path

func _is_enabled() -> bool:
    # 检查平台是否可用
    var platform := get_parent()
    if platform.has_method("is_active"):
        return platform.is_active()
    return true
```

## 7. 完整示例：AI 单位导航系统

```gdscript
# ai_navigation_controller.gd
# 完整的 AI 单位导航控制器
class_name AINavigationController
extends CharacterBody2D

signal destination_reached
signal path_updated(path: PackedVector2Array)

@export var navigation_agent: NavigationAgent2D
@export var move_speed: float = 150.0
@export var path_reach_distance: float = 10.0

@export var use_flow_field: bool = false
@export var flow_field: NavFlowField

@export var use_lod: bool = false
@export var lod_controller: LODPathfinding

var _target_position: Vector2 = Vector2.ZERO
var _current_path: PackedVector2Array = []
var _path_index: int = 0

func _ready() -> void:
    navigation_agent.velocity_computed.connect(_on_velocity_computed)

    set_physics_process(false)

    await get_tree().physics_frame
    set_physics_process(true)

func _physics_process(delta: float) -> void:
    if navigation_agent.is_navigation_finished():
        destination_reached.emit()
        return

    var next_pos: Vector2

    if use_flow_field and flow_field:
        # 流场导航
        next_pos = _get_flow_field_next_position(delta)
    else:
        # 标准导航
        next_pos = navigation_agent.get_next_path_position()

    var current_pos := global_position
    var new_velocity := (next_pos - current_pos).normalized() * move_speed

    if navigation_agent.velocity_computed.size() > 0:
        velocity = new_velocity
        move_and_slide()
    else:
        navigation_agent.velocity = new_velocity

func _get_flow_field_next_position(delta: float) -> Vector2:
    var flow_dir := flow_field.get_flow_direction(global_position)

    if flow_dir.length() > 0.01:
        return global_position + flow_dir * move_speed * delta
    else:
        return global_position

func set_destination(world_position: Vector2) -> void:
    _target_position = world_position

    if use_lod and lod_controller:
        var start_cell := navigation_agent.get_current_navigation_region()
        var end_cell := (world_position / lod_controller.tile_map.tile_set.tile_size).floor()
        _current_path = Array(lod_controller.find_path(start_cell, end_cell))
        _path_index = 0
        path_updated.emit(_current_path)

    navigation_agent.target_position = world_position

func _on_velocity_computed(velocity: Vector2) -> void:
    self.velocity = velocity
    move_and_slide()
```

## 性能优化建议

1. **使用 AStarGrid2D**：内置优化，比自定义 A* 更快
2. **流场共享**：大量单位共享流场，避免重复计算
3. **LOD 寻路**：远距离使用粗糙网格
4. **路径缓存**：相同起点终点复用缓存结果
5. **批量处理**：每帧限制寻路请求数量
6. **节流更新**：动态障碍物变化后延迟更新

## 最佳实践

- 优先使用 NavigationAgent2D，它与 NavigationServer 集成更好
- 导航网格变化时使用 `bake_navigation_polygon()` 重新烘焙
- NavLink 用于连接分离的导航区域
- 大量单位使用流场寻路
- 动态障碍物使用分块更新而非全局重算
