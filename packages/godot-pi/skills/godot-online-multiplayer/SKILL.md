---
name: godot-online-multiplayer
description: Godot 4 multiplayer patterns: scene sync, player lifecycle, death/respawn. Use when building online games, spawning players, or syncing multiplayer state.
---

# Godot Online Multiplayer

Godot 4 多人游戏核心模式，涵盖场景管理、玩家生命周期、死亡复活等机制。

## When to Use This Skill

- 构建多人在线游戏
- 实现玩家生成与销毁
- 处理多人游戏中的死亡与复活
- 管理游戏流程状态机
- 同步玩家数据

## Core Concepts

### 多人游戏架构

```
MultiplayerHost (服务器/主机)
├── MultiplayerSpawner (自动生成节点)
├── MultiplayerSynchronizer (状态同步)
└── PlayerManager (玩家管理)

MultiplayerPeers (客户端/对等端)
├── NetworkedMultiplayerENet (网络连接)
└── Player instances (同步的玩家)
```

## 1. 场景结构

### 主游戏场景

```gdscript
# main.tscn 场景结构
# Main (Node)
# ├── GameManager (Autoload)
# ├── MultiplayerSpawner (自动生成玩家)
# ├── World (Node2D)
# │   ├── SpawnPoints (Node)
# │   └── Enemies (Node)
# └── UI (CanvasLayer)
```

### 玩家场景

```gdscript
# player.tscn 场景结构
# Player (CharacterBody2D)
# ├── Sprite2D
# ├── CollisionShape2D
# ├── HealthComponent
# ├── HitboxComponent
# ├── NameLabel (Label)
# └── HealthBar (ProgressBar)
```

## 2. MultiplayerSpawner 使用

```gdscript
# PlayerSpawner.gd
class_name PlayerSpawner
extends MultiplayerSpawner

## 自动生成玩家节点
## 当对等端连接时自动生成玩家实例

signal player_spawned(player: Node, peer_id: int)
signal player_despawned(player: Node, peer_id: int)

@export var player_scene: PackedScene

func _ready() -> void:
    # 设置生成路径
    spawn_path = ^"/root/Main/Players"
    
    # 连接信号
    spawned.connect(_on_spawned)
    despawned.connect(_on_despawned)

func _on_spawned(node: Node) -> void:
    var peer_id := multiplayer.get_remote_sender_id()
    print("玩家生成: %s (Peer ID: %d)" % [node.name, peer_id])
    player_spawned.emit(node, peer_id)

func _on_despawned(node: Node) -> void:
    var peer_id := multiplayer.get_remote_sender_id()
    print("玩家销毁: %s (Peer ID: %d)" % [node.name, peer_id])
    player_despawned.emit(node, peer_id)
```

## 3. 生成函数

```gdscript
# spawn_manager.gd
class_name SpawnManager
extends Node

## 管理玩家生成逻辑

@export var player_scene: PackedScene
@export var spawn_points: Array[Marker2D] = []

var _spawn_points_container: Node2D

func _ready() -> void:
    _spawn_points_container = $SpawnPoints

func get_spawn_position(peer_id: int) -> Vector2:
    """根据peer_id获取生成位置"""
    if spawn_points.is_empty():
        return Vector2.ZERO
    
    # 使用 peer_id 哈希选择生成点，实现均衡分布
    var index := peer_id % spawn_points.size()
    var spawn_point := spawn_points[index]
    
    if spawn_point is Marker2D:
        return spawn_point.global_position
    
    return spawn_point.global_position if spawn_point.has_node(".") else Vector2.ZERO

func spawn_player(peer_id: int, parent: Node) -> Node:
    """生成玩家节点"""
    var player := player_scene.instantiate()
    
    # 设置玩家名称为 peer_id
    player.name = str(peer_id)
    
    # 设置初始位置
    player.global_position = get_spawn_position(peer_id)
    
    # 配置玩家
    if player.has_method("setup"):
        player.setup(peer_id)
    
    parent.add_child(player)
    
    # 只在服务器上设置网络主人
    if multiplayer.is_server():
        player.set_multiplayer_authority(peer_id)
    
    return player

func despawn_player(peer_id: int, parent: Node) -> void:
    """销毁玩家节点"""
    var player := parent.get_node_or_null(str(peer_id))
    if player:
        player.queue_free()
```

## 4. 玩家加入流程

```gdscript
# game_manager.gd (Autoload)
extends Node

signal player_joined(peer_id: int)
signal player_left(peer_id: int)
signal game_started
signal game_ended(winner_id: int)

enum GameState { WAITING, PLAYING, GAME_OVER }

var game_state: GameState = GameState.WAITING
var players: Dictionary = {}  # peer_id -> PlayerData
var _min_players: int = 1
var _max_players: int = 4

func _ready() -> void:
    # 设置网络回调
    multiplayer.peer_connected.connect(_on_peer_connected)
    multiplayer.peer_disconnected.connect(_on_peer_disconnected)
    
    # 如果是服务器，启动游戏循环
    if multiplayer.is_server():
        _check_start_game()

func _on_peer_connected(peer_id: int) -> void:
    print("玩家连接: %d" % peer_id)
    
    # 创建玩家数据
    var player_data := PlayerData.new()
    player_data.peer_id = peer_id
    player_data.name = "Player_%d" % peer_id
    player_data.is_alive = true
    player_data.score = 0
    
    players[peer_id] = player_data
    
    # 通知所有客户端有新玩家加入
    rpc("_sync_player_joined", peer_id, player_data.to_dict())
    
    player_joined.emit(peer_id)
    
    # 检查是否可以开始游戏
    _check_start_game()

func _on_peer_disconnected(peer_id: int) -> void:
    print("玩家断开: %d" % peer_id)
    
    # 清理玩家数据
    var player_data := players.get(peer_id)
    if player_data:
        player_data.free()
    
    players.erase(peer_id)
    
    # 通知所有客户端
    rpc("_sync_player_left", peer_id)
    
    player_left.emit(peer_id)
    
    # 检查游戏是否结束
    if game_state == GameState.PLAYING and players.size() < 2:
        _end_game(0)  # 剩余玩家获胜

@rpc(call_local = true)
func _sync_player_joined(peer_id: int, data: Dictionary) -> void:
    if not players.has(peer_id):
        var player_data := PlayerData.new()
        player_data.from_dict(data)
        players[peer_id] = player_data

@rpc(call_local = true)
func _sync_player_left(peer_id: int) -> void:
    var player_data := players.get(peer_id)
    if player_data:
        player_data.free()
    players.erase(peer_id)

func _check_start_game() -> void:
    if game_state == GameState.WAITING and players.size() >= _min_players:
        start_game()

func start_game() -> void:
    game_state = GameState.PLAYING
    game_started.emit()
    
    # 重置所有玩家状态
    for peer_id in players.keys():
        var data := players[peer_id]
        data.is_alive = true
        data.lives = 3
        data.score = 0
    
    rpc("_sync_game_state", GameState.PLAYING)

@rpc(call_local = true)
func _sync_game_state(state: GameState) -> void:
    game_state = state

func _end_game(winner_id: int) -> void:
    game_state = GameState.GAME_OVER
    game_ended.emit(winner_id)
    rpc("_sync_game_state", GameState.GAME_OVER)
    rpc("_sync_winner", winner_id)

@rpc(call_local = true)
func _sync_winner(winner_id: int) -> void:
    pass  # UI显示胜利者


# PlayerData.gd
class_name PlayerData
extends RefCounted

var peer_id: int
var name: String
var is_alive: bool
var lives: int = 3
var score: int = 0

func to_dict() -> Dictionary:
    return {
        "peer_id": peer_id,
        "name": name,
        "is_alive": is_alive,
        "lives": lives,
        "score": score
    }

func from_dict(data: Dictionary) -> void:
    peer_id = data.get("peer_id", 0)
    name = data.get("name", "")
    is_alive = data.get("is_alive", true)
    lives = data.get("lives", 3)
    score = data.get("score", 0)
```

## 5. 断开处理

```gdscript
# connection_manager.gd
class_name ConnectionManager
extends Node

signal connection_failed
signal connection_succeeded
signal server_disconnected

const DEFAULT_PORT := 8765
const MAX_PLAYERS := 8

func _ready() -> void:
    # 显示主菜单UI
    pass

func create_server(port: int = DEFAULT_PORT) -> bool:
    """创建服务器"""
    var peer := ENetMultiplayerPeer.new()
    
    var error := peer.create_server(port, MAX_PLAYERS)
    if error != OK:
        push_error("无法创建服务器: %s" % error)
        return false
    
    multiplayer.multiplayer_peer = peer
    
    # 连接信号
    peer.peer_connected.connect(_on_peer_connected)
    peer.peer_disconnected.connect(_on_peer_disconnected)
    
    print("服务器创建成功，端口: %d" % port)
    connection_succeeded.emit()
    
    return true

func join_server(ip: String, port: int = DEFAULT_PORT) -> bool:
    """加入服务器"""
    var peer := ENetMultiplayerPeer.new()
    
    var error := peer.create_client(ip, port)
    if error != OK:
        push_error("无法连接服务器: %s" % error)
        connection_failed.emit()
        return false
    
    multiplayer.multiplayer_peer = peer
    
    # 连接信号
    peer.connection_succeeded.connect(_on_connection_succeeded)
    peer.connection_failed.connect(_on_connection_failed)
    peer.server_disconnected.connect(_on_server_disconnected)
    
    print("正在连接 %s:%d..." % [ip, port])
    
    return true

func _on_peer_connected(peer_id: int) -> void:
    print("对等端连接: %d" % peer_id)

func _on_peer_disconnected(peer_id: int) -> void:
    print("对等端断开: %d" % peer_id)
    # GameManager 处理玩家离开逻辑

func _on_connection_succeeded() -> void:
    print("连接成功!")
    connection_succeeded.emit()

func _on_connection_failed() -> void:
    print("连接失败!")
    connection_failed.emit()

func _on_server_disconnected() -> void:
    print("服务器断开")
    server_disconnected.emit()
    
    # 返回主菜单
    get_tree().change_scene_to_file("res://scenes/menu.tscn")

func disconnect_from_server() -> void:
    if multiplayer.multiplayer_peer:
        multiplayer.multiplayer_peer.close()
        multiplayer.multiplayer_peer = null
```

## 6. 死亡与复活

```gdscript
# player.gd
class_name Player
extends CharacterBody2D

signal died(peer_id: int, killer_id: int)
signal respawned(peer_id: int)

@export var respawn_time: float = 3.0
@export var invincibility_after_spawn: float = 2.0

var peer_id: int = 0
var is_alive: bool = true
var killer_id: int = 0

var _respawn_timer: Timer
var _invincibility_timer: Timer
var _health_component: HealthComponent

func _ready() -> void:
    # 获取生命组件
    _health_component = $HealthComponent
    
    if _health_component:
        _health_component.died.connect(_on_died)
    
    # 创建计时器
    _respawn_timer = Timer.new()
    _respawn_timer.one_shot = true
    _respawn_timer.timeout.connect(_on_respawn_timer_timeout)
    add_child(_respawn_timer)
    
    _invincibility_timer = Timer.new()
    _invincibility_timer.one_shot = true
    _invincibility_timer.timeout.connect(_on_invincibility_timeout)
    add_child(_invincibility_timer)

func setup(p_id: int) -> void:
    peer_id = p_id
    name = str(p_id)
    
    # 设置网络权限
    set_multiplayer_authority(p_id)
    
    # 在所有客户端上设置可见性
   .rpc("_sync_setup", p_id)

@rpc
func _sync_setup(p_id: int) -> void:
    peer_id = p_id
    name = str(p_id)

func _on_died(source_peer_id: int) -> void:
    if not is_alive:
        return
    
    is_alive = false
    killer_id = source_peer_id
    
    died.emit(peer_id, killer_id)
    
    # 通知服务器
    rpc("_notify_death", peer_id, source_peer_id)

@rpc(call_local = true)
func _notify_death(victim_id: int, killer_id: int) -> void:
    died.emit(victim_id, killer_id)
    
    # 服务器处理死亡逻辑
    if multiplayer.is_server():
        GameManager.on_player_died(victim_id, killer_id)
        
        # 开始复活计时
        _start_respawn_timer()

func _start_respawn_timer() -> void:
    _respawn_timer.start(respawn_time)

func _on_respawn_timer_timeout() -> void:
    if is_networked():
        rpc("_request_respawn", peer_id)
    else:
        _do_respawn()

@rpc
func _request_respawn(p_id: int) -> void:
    if multiplayer.is_server():
        _do_respawn_for_player(p_id)

func _do_respawn_for_player(p_id: int) -> void:
    # 服务器检查是否可以复活
    var player_data := GameManager.players.get(p_id)
    if player_data and player_data.lives > 0:
        rpc("_perform_respawn", p_id)

@rpc(call_local = true)
func _perform_respawn(p_id: int) -> void:
    if peer_id != p_id:
        return
    
    # 重置状态
    is_alive = true
    _health_component.current_health = _health_component.max_health
    
    # 移动到生成点
    global_position = SpawnManager.get_spawn_position(p_id)
    
    # 无敌时间
    _invincibility_timer.start(invincibility_after_spawn)
    
    respawned.emit(peer_id)

func _on_invincibility_timeout() -> void:
    # 恢复碰撞
    pass

func take_damage(amount: int, source_peer_id: int) -> void:
    if not is_alive:
        return
    
    if _health_component:
        _health_component.take_damage(amount, get_node_or_null(str(source_peer_id)))
```

## 7. 游戏结束检查

```gdscript
# game_manager.gd 继续

func on_player_died(victim_id: int, killer_id: int) -> void:
    """处理玩家死亡"""
    var victim_data := players.get(victim_id)
    var killer_data := players.get(killer_id)
    
    if not victim_data:
        return
    
    # 标记死亡
    victim_data.is_alive = false
    victim_data.lives -= 1
    
    # 给击杀者加分
    if killer_data and killer_id != victim_id:
        killer_data.score += 100
        rpc("_sync_player_scored", killer_id, killer_data.score)
    
    # 检查游戏是否结束
    _check_game_over()
    
    # 检查是否需要回合复活
    _check_round_respawn(victim_id)

func _check_game_over() -> void:
    """检查是否触发游戏结束"""
    var alive_players := players.values().filter(func(p): return p.is_alive)
    
    # 只剩一个玩家
    if alive_players.size() <= 1 and game_state == GameState.PLAYING:
        if alive_players.is_empty():
            _end_game(0)  # 平局
        else:
            _end_game(alive_players[0].peer_id)

func _check_round_respawn(victim_id: int) -> void:
    """检查是否进行回合复活"""
    var player_data := players.get(victim_id)
    if player_data and player_data.lives > 0:
        # 有剩余生命值，准备复活
        rpc("_schedule_round_respawn", victim_id, player_data.lives)

@rpc(call_local = true)
func _schedule_round_respawn(peer_id: int, remaining_lives: int) -> void:
    # UI显示复活倒计时
    pass

@rpc(call_local = true)
func _sync_player_scored(peer_id: int, new_score: int) -> void:
    var player_data := players.get(peer_id)
    if player_data:
        player_data.score = new_score
```

## 8. 回合复活

```gdscript
# round_manager.gd
class_name RoundManager
extends Node

signal round_started(round_number: int)
signal round_ended(round_number: int, winner_id: int)
signal all_rounds_ended(final_winner_id: int)

@export var rounds_to_win: int = 3
@export var round_intermission_time: float = 3.0

var current_round: int = 1
var round_state: RoundState = RoundState.INTERMISSION
var player_wins: Dictionary = {}  # peer_id -> wins

enum RoundState { INTERMISSION, FIGHTING, ROUND_END }

func _ready() -> void:
    GameManager.game_started.connect(_on_game_started)
    GameManager.game_ended.connect(_on_game_ended)

func _on_game_started() -> void:
    current_round = 1
    round_state = RoundState.INTERMISSION
    player_wins.clear()
    
    # 初始化所有玩家的胜利数
    for peer_id in GameManager.players.keys():
        player_wins[peer_id] = 0
    
    _start_round_intermission()

func _start_round_intermission() -> void:
    round_state = RoundState.INTERMISSION
    rpc("_sync_round_state", RoundState.INTERMISSION, current_round)
    
    # 3秒后开始回合
    await get_tree().create_timer(round_intermission_time).timeout
    _start_round()

func _start_round() -> void:
    round_state = RoundState.FIGHTING
    rpc("_sync_round_state", RoundState.FIGHTING, current_round)
    round_started.emit(current_round)
    
    # 重置所有玩家位置和状态
    rpc("_reset_all_players_for_round")

@rpc(call_local = true)
func _sync_round_state(state: RoundState, round_num: int) -> void:
    round_state = state
    current_round = round_num

@rpc(call_local = true)
func _reset_all_players_for_round() -> void:
    # 重置玩家状态用于新回合
    for peer_id_str in GameManager.players.keys():
        var peer_id := int(peer_id_str)
        var player := get_tree().get_first_node_in_group("players").get_node_or_null(str(peer_id))
        if player:
            player.global_position = SpawnManager.get_spawn_position(peer_id)
            player.is_alive = true
            if player.has_method("reset_for_round"):
                player.reset_for_round()

func on_player_died_in_round(victim_id: int, killer_id: int) -> void:
    """回合中玩家死亡"""
    if round_state != RoundState.FIGHTING:
        return
    
    var alive_players := _get_alive_players()
    
    if alive_players.size() <= 1:
        _end_round(alive_players[0] if alive_players else 0)

func _get_alive_players() -> Array:
    var alive: Array = []
    for peer_id in GameManager.players.keys():
        var data := GameManager.players[peer_id]
        if data.is_alive:
            alive.append(peer_id)
    return alive

func _end_round(winner_id: int) -> void:
    round_state = RoundState.ROUND_END
    round_ended.emit(current_round, winner_id)
    
    if winner_id != 0:
        player_wins[winner_id] += 1
    
    # 检查是否有人获胜
    for peer_id in player_wins.keys():
        if player_wins[peer_id] >= rounds_to_win:
            _end_game(peer_id)
            return
    
    # 下一回合
    current_round += 1
    _start_round_intermission()

func _end_game(winner_id: int) -> void:
    all_rounds_ended.emit(winner_id)
    GameManager._end_game(winner_id)

func _on_game_ended(winner_id: int) -> void:
    round_state = RoundState.ROUND_END
```

## 9. 场景切换

```gdscript
# scene_transition.gd
class_name SceneTransition
extends CanvasLayer

@export var transition_duration: float = 0.5
@export var fade_color: Color = Color.BLACK

var _transition_tween: Tween
var _color_rect: ColorRect

func _ready() -> void:
    # 创建过渡用的 ColorRect
    _color_rect = ColorRect.new()
    _color_rect.color = Color.TRANSPARENT
    _color_rect.set_anchors_preset(Control.PRESET_FULL_RECT)
    add_child(_color_rect)

func fade_to_black() -> void:
    """淡出到黑色"""
    if _transition_tween:
        _transition_tween.kill()
    
    _transition_tween = create_tween()
    _transition_tween.tween_property(_color_rect, "color", fade_color, transition_duration)
    
    await _transition_tween.finished

func fade_from_black() -> void:
    """从黑色淡入"""
    if _transition_tween:
        _transition_tween.kill()
    
    _color_rect.color = fade_color
    _transition_tween = create_tween()
    _transition_tween.tween_property(_color_rect, "color", Color.TRANSPARENT, transition_duration)
    
    await _transition_tween.finished

func change_scene(scene_path: String) -> void:
    """带过渡的场景切换"""
    await fade_to_black()
    get_tree().change_scene_to_file(scene_path)
    await fade_from_black()

# 使用示例
func _on_play_pressed() -> void:
    var transition := $SceneTransition
    await transition.fade_to_black()
    
    get_tree().change_scene_to_file("res://scenes/game.tscn")
    
    await transition.fade_from_black()
```

## 10. 游戏流程状态机

```gdscript
# game_state_machine.gd
class_name GameStateMachine
extends Node

## 游戏流程状态机

signal state_changed(from_state: GameStates, to_state: GameStates)

enum GameStates { 
    MAIN_MENU, 
    CONNECTING, 
    WAITING_FOR_PLAYERS, 
    LOADING, 
    PLAYING, 
    PAUSED, 
    ROUND_END, 
    GAME_OVER 
}

@export var initial_state: GameStates = GameStates.MAIN_MENU

var current_state: GameStates
var previous_state: GameStates

func _ready() -> void:
    current_state = initial_state
    _enter_state(current_state)

func transition_to(new_state: GameStates, msg: Dictionary = {}) -> void:
    if new_state == current_state:
        return
    
    previous_state = current_state
    var old_state := current_state
    current_state = new_state
    
    _exit_state(old_state)
    _enter_state(new_state, msg)
    
    state_changed.emit(old_state, new_state)

func _enter_state(state: GameStates, msg: Dictionary = {}) -> void:
    match state:
        GameStates.MAIN_MENU:
            _enter_main_menu()
        GameStates.CONNECTING:
            _enter_connecting()
        GameStates.WAITING_FOR_PLAYERS:
            _enter_waiting()
        GameStates.LOADING:
            _enter_loading()
        GameStates.PLAYING:
            _enter_playing()
        GameStates.PAUSED:
            _enter_paused()
        GameStates.ROUND_END:
            _enter_round_end()
        GameStates.GAME_OVER:
            _enter_game_over()

func _exit_state(state: GameStates) -> void:
    match state:
        GameStates.MAIN_MENU:
            _exit_main_menu()
        GameStates.CONNECTING:
            _exit_connecting()
        GameStates.WAITING_FOR_PLAYERS:
            _exit_waiting()
        GameStates.LOADING:
            _exit_loading()
        GameStates.PLAYING:
            _exit_playing()
        GameStates.PAUSED:
            _exit_paused()
        GameStates.ROUND_END:
            _exit_round_end()
        GameStates.GAME_OVER:
            _exit_game_over()

func _enter_main_menu() -> void:
    get_tree().paused = false
    get_tree().change_scene_to_file("res://scenes/menu.tscn")

func _exit_main_menu() -> void:
    pass

func _enter_connecting() -> void:
    # 显示连接界面
    pass

func _exit_connecting() -> void:
    pass

func _enter_waiting() -> void:
    # 显示等待玩家界面
    GameManager.game_state = GameManager.GameState.WAITING
    RoundManager._start_round_intermission()

func _exit_waiting() -> void:
    pass

func _enter_loading() -> void:
    # 显示加载界面
    pass

func _exit_loading() -> void:
    pass

func _enter_playing() -> void:
    get_tree().paused = false
    GameManager.game_state = GameManager.GameState.PLAYING

func _exit_playing() -> void:
    pass

func _enter_paused() -> void:
    get_tree().paused = true
    # 显示暂停菜单
    pass

func _exit_paused() -> void:
    get_tree().paused = false

func _enter_round_end() -> void:
    # 显示回合结束界面
    pass

func _exit_round_end() -> void:
    pass

func _enter_game_over() -> void:
    GameManager.game_state = GameManager.GameState.GAME_OVER
    # 显示游戏结束界面
    pass

func _exit_game_over() -> void:
    pass

func _process(delta: float) -> void:
    match current_state:
        GameStates.MAIN_MENU:
            _update_main_menu(delta)
        GameStates.WAITING_FOR_PLAYERS:
            _update_waiting(delta)
        GameStates.PLAYING:
            _update_playing(delta)

func _update_main_menu(_delta: float) -> void:
    pass

func _update_waiting(_delta: float) -> void:
    # 检查玩家数量
    if GameManager.players.size() >= GameManager._min_players:
        transition_to(GameStates.LOADING)

func _update_playing(_delta: float) -> void:
    pass
```

## 11. 数据管理(玩家字典)

```gdscript
# player_data.gd
class_name PlayerData
extends RefCounted

## 玩家数据结构

var peer_id: int = 0
var name: String = ""
var is_alive: bool = true
var lives: int = 3
var score: int = 0
var kills: int = 0
var deaths: int = 0
var ping: int = 0
var last_position: Vector2 = Vector2.ZERO
var custom_data: Dictionary = {}

func _init() -> void:
    pass

func to_dict() -> Dictionary:
    """序列化为字典"""
    return {
        "peer_id": peer_id,
        "name": name,
        "is_alive": is_alive,
        "lives": lives,
        "score": score,
        "kills": kills,
        "deaths": deaths,
        "ping": ping,
        "last_position": {"x": last_position.x, "y": last_position.y},
        "custom_data": custom_data
    }

func from_dict(data: Dictionary) -> void:
    """从字典反序列化"""
    peer_id = data.get("peer_id", 0)
    name = data.get("name", "")
    is_alive = data.get("is_alive", true)
    lives = data.get("lives", 3)
    score = data.get("score", 0)
    kills = data.get("kills", 0)
    deaths = data.get("deaths", 0)
    ping = data.get("ping", 0)
    
    var pos_dict: Dictionary = data.get("last_position", {})
    last_position = Vector2(pos_dict.get("x", 0), pos_dict.get("y", 0))
    
    custom_data = data.get("custom_data", {})

func reset() -> void:
    """重置玩家数据"""
    is_alive = true
    lives = 3
    score = 0
    kills = 0
    deaths = 0
    last_position = Vector2.ZERO

func add_kill() -> void:
    kills += 1
    score += 100

func add_death() -> void:
    deaths += 1
    lives = maxi(lives - 1, 0)

func update_ping(new_ping: int) -> void:
    ping = new_ping


# player_registry.gd
class_name PlayerRegistry
extends Node

## 玩家注册表，管理所有玩家数据

signal player_registered(peer_id: int, data: PlayerData)
signal player_unregistered(peer_id: int)
signal player_updated(peer_id: int, data: PlayerData)

var _players: Dictionary = {}  # peer_id -> PlayerData

func _ready() -> void:
    # 连接 GameManager 信号
    if GameManager:
        GameManager.player_joined.connect(_on_player_joined)
        GameManager.player_left.connect(_on_player_left)

func register_player(peer_id: int, data: PlayerData) -> void:
    _players[peer_id] = data
    player_registered.emit(peer_id, data)

func unregister_player(peer_id: int) -> void:
    if _players.has(peer_id):
        _players.erase(peer_id)
        player_unregistered.emit(peer_id)

func get_player(peer_id: int) -> PlayerData:
    return _players.get(peer_id)

func get_all_players() -> Array[PlayerData]:
    return Array(_players.values(), TYPE_OBJECT, "", null)

func get_alive_players() -> Array[PlayerData]:
    return get_all_players().filter(func(p): return p.is_alive)

func get_player_count() -> int:
    return _players.size()

func has_player(peer_id: int) -> bool:
    return _players.has(peer_id)

func _on_player_joined(peer_id: int) -> void:
    var data := PlayerData.new()
    data.peer_id = peer_id
    data.name = "Player_%d" % peer_id
    register_player(peer_id, data)

func _on_player_left(peer_id: int) -> void:
    unregister_player(peer_id)

func update_player(peer_id: int, updater: Callable) -> void:
    """使用回调更新玩家数据"""
    var data := get_player(peer_id)
    if data:
        updater.call(data)
        player_updated.emit(peer_id, data)
