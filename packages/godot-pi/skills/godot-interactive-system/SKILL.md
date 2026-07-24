---
name: godot-interactive-system
description: Godot 4 InteractiveComponent pattern for NPC talk, area triggers, shops. Use when adding player-world interaction, dialogue triggers, or proximity prompts.
---

# Godot 可交互组件设计

## 概述

可交互组件系统用于实现玩家与游戏世界中各种对象的交互，如 NPC 对话、场景切换、商店等。系统采用代理模式，通过 `InteractiveComponent` 统一管理交互检测和事件分发。

## 1. 架构设计

### 1.1 整体架构

```
玩家角色 (CharacterBase)
    │
    ├── Talk Area2D (collision_mask = 256) ← 交互检测区域
    │       │
    │       └── Area Entered/Exited Signals
    │
    └── try_interact() ← 按 "talk" 键触发
            │
            ├── talk_target.player_interact()  [NPC对话]
            │
            └── interactable_area.interact()   [关卡出口/商店]
```

### 1.2 可交互对象类型

| 类型 | 实现方式 | 触发方式 |
|------|----------|----------|
| NPC 对话 | `npc_base.gd` | 按键触发 |
| 关卡出口 | `interactable_level_exit.gd` | 按键触发 |
| 商店 | 自定义 `player_interact` | 按键触发 |
| 门 | 自动检测 | 区域进入自动触发 |

## 2. 交互检测机制

### 2.1 玩家端配置

```gdscript
@onready var talk: Area2D = $Body/talk
var talk_target = null
var interactable_area = null
```

**Talk Area 配置**：
```
collision_layer = 0         # 不作为碰撞层
collision_mask = 256        # 检测位于256层的交互对象
monitorable = false         # 不被其他 Area 检测
```

### 2.2 进入/离开交互区域

```gdscript
func _on_talk_area_entered(area: Area2D) -> void:
    if not area is InteractiveComponent:
        return
    if talk_target:
        talk_target.exit_interact(self)
        talk_target = null
    if area.has_method("enter_interact"):
        talk_target = area
        talk_target.enter_interact(self)

func _on_talk_area_exited(area: Area2D) -> void:
    if talk_target == area:
        talk_target.exit_interact(self)
        talk_target = null
```

### 2.3 交互触发

```gdscript
func try_interact():
    if (not talk.has_overlapping_areas() or not talk_target) and not interactable_area:
        return
    if talk_target and talk_target.has_method("player_interact"):
        talk_target.player_interact(self)
        return
    if interactable_area:
        interactable_area.interact(self)
        return
```

## 3. InteractiveComponent 代理组件

### 3.1 核心实现

```gdscript
class_name InteractiveComponent
extends Area2D

@export var agent: Node2D = null

func player_interact(player: CharacterBase):
    if not agent:
        return
    agent.player_interact(player)

func enter_interact(player: CharacterBase):
    if not agent:
        return
    agent.enter_interact(player)

func exit_interact(player: CharacterBase):
    if not agent:
        return
    agent.exit_interact(player)
```

**场景配置**：
```
collision_layer = 256
collision_mask = 0
monitoring = false
```

### 3.2 代理模式优势

```
玩家交互请求
        ↓
InteractiveComponent.player_interact()
        ↓
agent.player_interact()
```

- `InteractiveComponent` 可复用于不同对象
- 业务逻辑放在 `agent` 中，便于维护
- 可以动态切换 `agent` 改变交互行为

## 4. 常见交互类型

### 4.1 NPC 对话交互

```gdscript
class_name NPCBase
extends CharacterBody2D

@export var interactable: bool = true
signal dialogue_started

func _physics_process(delta: float) -> void:
    if interactable:
        if can_talk_to_npc():
            if Input.is_action_just_pressed("talk"):
                if !interact_lock:
                    dialogue_in_progress = true
                    dialogue_started.emit()
```

### 4.2 关卡出口交互

**普通出口** - 进入即触发：
```gdscript
class_name LevelExit
extends Area2D

func _on_body_entered(body: Node2D):
    if body is CharacterBase:
        body.position = Vector2(-10000, -10000)
        body.hide()
        LevelManager.call_deferred("change_scene",
            LevelManager.ChangeSceneParam.new(target_scene_path, target_scene_entry_tag))
```

**可交互出口** - 需按键触发：
```gdscript
class_name InteractableLevelExit
extends LevelExit

func interact(body):
    body.position = Vector2(-10000, -10000)
    body.hide()
    LevelManager.call_deferred("change_scene",
        LevelManager.ChangeSceneParam.new(target_scene_path, target_scene_entry_tag))
```

### 4.3 商店交互

```gdscript
func player_interact(player: CharacterBase):
    var game_operation = handle_game_operation.bind(player)
    GameDirector.wait_game.connect(game_operation)
    GameDirector.load_chapter("res://chapters/store_test.json")
    await GameDirector.finished
    GameDirector.wait_game.disconnect(game_operation)

func enter_interact(player: CharacterBase):
    var interact_material := ShaderMaterial.new()
    interact_material.shader = load("res://resource/shaders/border.gdshader")
    interact_material.set_shader_parameter("outline_color", Color(1, 1, 1, 1))
    sprite_2d.material = interact_material

func exit_interact(_player: CharacterBase):
    sprite_2d.material = null
```

### 4.4 门交互（自动触发）

```gdscript
enum DoorState { CLOSED, OPEN_LEFT, OPEN_RIGHT }

func _on_left_in_body_entered(body: Node2D) -> void:
    if door_state == DoorState.CLOSED:
        door_state = DoorState.OPEN_RIGHT
        animated_sprite_2d.play("open_right")
```

## 5. 交互对象场景配置

```
可交互对象
    │
    ├── InteractiveComponent (collision_layer = 256)
    │       │
    │       └── agent: Node2D ← 实际处理逻辑的节点
    │
    ├── NPC (npc_base.gd)
    │
    ├── InteractableLevelExit (interactable_level_exit.gd)
    │
    └── Store (自定义 player_interact)
```

## 6. 设计模式总结

| 模式 | 应用场景 |
|------|----------|
| **代理模式** | `InteractiveComponent` 转发交互请求给 `agent` |
| **观察者模式** | `talk_target` 跟踪当前交互目标 |
| **状态机** | NPC 行为状态管理 |
| **导演模式** | `GameDirector` 统一管理游戏流程 |
