---
name: godot-save-system
description: Godot 4 save/load design: Resource serialization, encryption, slots, rollback. Use when implementing save games, persistent progress, or encrypted save files.
---

# Godot 存档系统设计

## 概述

存档系统是游戏的核心功能之一，负责保存和加载玩家数据。Godot 提供了 FileAccess、ResourceSaver 等工具，结合 JSON 或二进制格式实现存档功能。

## 1. 存档管理器

### 1.1 核心实现

```gdscript
# save_manager.gd (Autoload)
extends Node

const SAVE_PATH := "user://savegame.save"
const ENCRYPTION_KEY := "your_secret_key_here"

signal save_completed
signal load_completed
signal save_error(message: String)

func save_game(data: Dictionary) -> void:
    var file := FileAccess.open_encrypted_with_pass(
        SAVE_PATH,
        FileAccess.WRITE,
        ENCRYPTION_KEY
    )

    if file == null:
        save_error.emit("Could not open save file")
        return

    var json := JSON.stringify(data)
    file.store_string(json)
    file.close()

    save_completed.emit()

func load_game() -> Dictionary:
    if not FileAccess.file_exists(SAVE_PATH):
        return {}

    var file := FileAccess.open_encrypted_with_pass(
        SAVE_PATH,
        FileAccess.READ,
        ENCRYPTION_KEY
    )

    if file == null:
        save_error.emit("Could not open save file")
        return {}

    var json := file.get_as_text()
    file.close()

    var parsed := JSON.parse_string(json)
    if parsed == null:
        save_error.emit("Could not parse save data")
        return {}

    load_completed.emit()
    return parsed

func delete_save() -> void:
    if FileAccess.file_exists(SAVE_PATH):
        DirAccess.remove_absolute(SAVE_PATH)

func has_save() -> bool:
    return FileAccess.file_exists(SAVE_PATH)
```

## 2. 可存档对象

### 2.1 Saveable 基类

```gdscript
# saveable.gd
class_name Saveable
extends Node

@export var save_id: String

func _ready() -> void:
    if save_id.is_empty():
        save_id = str(get_path())

func get_save_data() -> Dictionary:
    var parent := get_parent()
    var data := {"id": save_id}

    if parent is Node2D:
        data["position"] = {"x": parent.position.x, "y": parent.position.y}

    if parent.has_method("get_custom_save_data"):
        data.merge(parent.get_custom_save_data())

    return data

func load_save_data(data: Dictionary) -> void:
    var parent := get_parent()

    if data.has("position") and parent is Node2D:
        parent.position = Vector2(data.position.x, data.position.y)

    if parent.has_method("load_custom_save_data"):
        parent.load_custom_save_data(data)
```

### 2.2 使用示例

```gdscript
# 玩家自定义存档数据
class_name Player
extends CharacterBody2D

func get_custom_save_data() -> Dictionary:
    return {
        "health": health_component.current_health,
        "inventory": inventory_component.list(),
        "level": level
    }

func load_custom_save_data(data: Dictionary) -> void:
    health_component.current_health = data.health
    level = data.level
```

## 3. 存档数据结构

### 3.1 完整存档格式

```gdscript
{
    "version": "1.0.0",
    "timestamp": 1712236800,
    "player": {
        "id": "player",
        "position": {"x": 100.0, "y": 200.0},
        "health": 80,
        "level": 5,
        "inventory": [...]
    },
    "world": {
        "enemies_killed": 42,
        "time_elapsed": 3600.0
    },
    "settings": {
        "difficulty": "normal",
        "sound_volume": 0.8
    }
}
```

## 4. 场景状态管理

```gdscript
# scene_save_manager.gd
class_name SceneSaveManager
extends Node

@export var saveable_groups: Array[String] = ["saveable"]

func capture_scene_state() -> Dictionary:
    var save_data := {}

    for group in saveable_groups:
        for node in get_tree().get_nodes_in_group(group):
            if node is Saveable:
                save_data[node.save_id] = node.get_save_data()

    return save_data

func restore_scene_state(data: Dictionary) -> void:
    for save_id in data.keys():
        var node = get_node_or_null(save_id)
        if node and node is Saveable:
            node.load_save_data(data[save_id])
```

## 5. 自动保存机制

```gdscript
# auto_save.gd
class_name AutoSave
extends Node

@export var auto_save_interval: float = 300.0  # 5分钟
@export var save_on_exit: bool = true

var _timer: float = 0.0

func _ready() -> void:
    if save_on_exit:
        get_tree().node_removed.connect(_on_node_removed)

func _process(delta: float) -> void:
    _timer += delta
    if _timer >= auto_save_interval:
        _timer = 0.0
        perform_save()

func perform_save() -> void:
    var scene_state := SceneSaveManager.capture_scene_state()
    var full_data := {
        "version": ProjectSettings.get_setting("application/config/version"),
        "timestamp": Time.get_unix_time_from_system(),
        "scene": saveable_groups,
        "data": scene_state
    }
    SaveManager.save_game(full_data)

func _on_node_removed(node: Node) -> void:
    if node is Player:
        perform_save()
```

## 6. 设计模式总结

| 模式 | 应用场景 |
|------|----------|
| **备忘录模式** | 保存/恢复对象状态 |
| **观察者模式** | 信号通知存档状态变化 |
| **外观模式** | SaveManager 提供统一存档接口 |
| **策略模式** | 支持多种存档格式（JSON、二进制） |

## 7. 注意事项

| 注意事项 | 说明 |
|----------|------|
| **数据验证** | 加载前验证存档版本和完整性 |
| **向后兼容** | 处理旧版本存档的字段缺失 |
| **加密存储** | 敏感数据使用加密 |
| **异步操作** | 大型存档使用异步读写 |
