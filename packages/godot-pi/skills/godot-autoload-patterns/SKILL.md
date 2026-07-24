---
name: godot-autoload-patterns
description: Godot 4 Autoload singleton patterns: global state, event bus, signal communication. Use when adding autoloads, GameData, EventBus, or global managers.
---

# Godot Autoload 单例模式

## 概述

Autoload（自动加载）是 Godot 中的单例功能，允许脚本在游戏开始时自动加载并在整个游戏周期中存在。正确使用 Autoload 可以有效管理全局状态和系统服务。

## 1. 全局数据管理

### 1.1 GameData 单例

```gdscript
# game_data.gd (Add to Project Settings > Autoload)
extends Node

enum GameState { MENU, PLAYING, PAUSED, GAME_OVER }

var state: GameState = GameState.MENU
var score: int = 0:
    set(value):
        score = value
        score_changed.emit(score)

var high_score: int = 0
var level: int = 1
var player_health: int = 100

func _ready() -> void:
    process_mode = Node.PROCESS_MODE_ALWAYS
    _load_high_score()

func _input(event: InputEvent) -> void:
    if event.is_action_pressed("pause") and state == GameState.PLAYING:
        toggle_pause()

func start_game() -> void:
    score = 0
    state = GameState.PLAYING
    game_started.emit()

func toggle_pause() -> void:
    var is_paused := state != GameState.PAUSED

    if is_paused:
        state = GameState.PAUSED
        get_tree().paused = true
    else:
        state = GameState.PLAYING
        get_tree().paused = false

    game_paused.emit(is_paused)

func end_game(won: bool) -> void:
    state = GameState.GAME_OVER

    if score > high_score:
        high_score = score
        _save_high_score()

    game_over.emit(won)

func add_score(points: int) -> void:
    score += points

func _load_high_score() -> void:
    if FileAccess.file_exists("user://high_score.save"):
        var file := FileAccess.open("user://high_score.save", FileAccess.READ)
        high_score = file.get_32()

func _save_high_score() -> void:
    var file := FileAccess.open("user://high_score.save", FileAccess.WRITE)
    file.store_32(high_score)
```

## 2. 事件总线模式

### 2.1 EventBus 单例

```gdscript
# event_bus.gd (Autoload)
extends Node

# Player events
signal player_spawned(player: Node2D)
signal player_died(player: Node2D)
signal player_health_changed(health: int, max_health: int)

# Enemy events
signal enemy_spawned(enemy: Node2D)
signal enemy_died(enemy: Node2D, position: Vector2)
signal wave_started(wave_number: int)

# Item events
signal item_collected(item_type: StringName, value: int)
signal powerup_activated(powerup_type: StringName)

# Level events
signal level_started(level_number: int)
signal level_completed(level_number: int, time: float)
signal checkpoint_reached(checkpoint_id: int)

# Game state events
signal game_paused(is_paused: bool)
signal game_over(won: bool)
```

### 2.2 使用示例

```gdscript
# 在任意脚本中连接信号
class_name Enemy
extends CharacterBody2D

func die() -> void:
    EventBus.enemy_died.emit(self, global_position)
    queue_free()
```

```gdscript
# 监听信号
class_name GameManager
extends Node

func _ready() -> void:
    EventBus.enemy_died.connect(_on_enemy_died)
    EventBus.level_started.connect(_on_level_started)

func _on_enemy_died(enemy: Node2D, position: Vector2) -> void:
    spawn_drops(position)
    add_score(10)

func _on_level_started(level_number: int) -> void:
    prepare_waves(level_number)
```

## 3. 服务管理器

### 3.1 AudioManager

```gdscript
# audio_manager.gd (Autoload)
extends Node

@export var bgm_bus: int = 0
@export var sfx_bus: int = 1

var _bgm_player: AudioStreamPlayer
var _sfx_player: AudioStreamPlayer

func _ready() -> void:
    _bgm_player = AudioStreamPlayer.new()
    _sfx_player = AudioStreamPlayer.new()
    add_child(_bgm_player)
    add_child(_sfx_player)

func play_bgm(stream: AudioStream, volume_db: float = 0.0) -> void:
    _bgm_player.stream = stream
    _bgm_player.volume_db = volume_db
    _bgm_player.play()

func play_sfx(stream: AudioStream, volume_db: float = 0.0) -> void:
    _sfx_player.stream = stream
    _sfx_player.volume_db = volume_db
    _sfx_player.play()

func stop_bgm() -> void:
    _bgm_player.stop()
```

### 3.2 SceneManager

```gdscript
# scene_manager.gd (Autoload)
extends Node

signal scene_loading_progress(progress: float)
signal scene_loaded(scene: Node)

var _current_scene: Node
var _loader: ResourceLoader

func _ready() -> void:
    _current_scene = get_tree().current_scene

func change_scene(scene_path: String) -> void:
    scene_loading_progress.emit(0.0)

    if ResourceLoader.has_cached(scene_path):
        var scene := load(scene_path) as PackedScene
        _swap_scene(scene.instantiate())
        return

    ResourceLoader.load_threaded_request(scene_path)

    while true:
        var progress := []
        var status := ResourceLoader.load_threaded_get_status(scene_path, progress)

        match status:
            ResourceLoader.THREAD_LOAD_IN_PROGRESS:
                scene_loading_progress.emit(progress[0])
                await get_tree().process_frame
            ResourceLoader.THREAD_LOAD_LOADED:
                var scene := ResourceLoader.load_threaded_get(scene_path) as PackedScene
                _swap_scene(scene.instantiate())
                return
            _:
                push_error("Failed to load scene: %s" % scene_path)
                return

func _swap_scene(new_scene: Node) -> void:
    if _current_scene:
        _current_scene.queue_free()

    _current_scene = new_scene
    get_tree().root.add_child(_current_scene)
    get_tree().current_scene = _current_scene
    scene_loaded.emit(_current_scene)
```

## 4. 场景结构

```
Project Settings > Autoload
├── GameData          # 全局游戏数据
├── EventBus         # 事件总线
├── AudioManager     # 音频管理
├── SceneManager     # 场景管理
├── SaveManager      # 存档管理
└── InputManager     # 输入管理
```

## 5. 设计原则

| 原则 | 说明 |
|------|------|
| **最小化原则** | 只将真正需要全局访问的对象设为 Autoload |
| **单一职责** | 每个 Autoload 只负责一个功能 |
| **信号解耦** | 优先使用 EventBus 信号通信 |
| **避免滥用** | 过多 Autoload 会使代码耦合度增加 |

## 6. 注意事项

| 注意事项 | 说明 |
|----------|------|
| **初始化顺序** | Autoload 按配置顺序初始化 |
| ** PROCESS_MODE_ALWAYS** | 需要在暂停时运行的脚本设置此模式 |
| **避免循环依赖** | Autoload 之间不要相互引用形成循环 |
| **线程安全** | 多线程场景注意信号线程安全 |
