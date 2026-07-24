---
name: godot-state-machine
description: Godot 4 finite state machine: State base, StateMachine, transitions, input. Use when implementing character/AI FSMs or refactoring large match/if state logic.
---

# Godot 有限状态机设计

## 概述

有限状态机（FSM）是游戏开发中最常用的设计模式之一，用于管理角色或对象的行为状态。通过将行为拆分为独立的状态类，状态机可以清晰管理状态转换、减少条件判断，使代码结构更加清晰。

## 1. 状态机核心架构

### 1.1 状态机管理器

```gdscript
# state_machine.gd
class_name StateMachine
extends Node

signal state_changed(from_state: StringName, to_state: StringName)

@export var initial_state: State

var current_state: State
var states: Dictionary = {}

func _ready() -> void:
    for child in get_children():
        if child is State:
            states[child.name] = child
            child.state_machine = self
            child.process_mode = Node.PROCESS_MODE_DISABLED

    if initial_state:
        current_state = initial_state
        current_state.process_mode = Node.PROCESS_MODE_INHERIT
        current_state.enter()

func _process(delta: float) -> void:
    if current_state:
        current_state.update(delta)

func _physics_process(delta: float) -> void:
    if current_state:
        current_state.physics_update(delta)

func _unhandled_input(event: InputEvent) -> void:
    if current_state:
        current_state.handle_input(event)

func transition_to(state_name: StringName, msg: Dictionary = {}) -> void:
    if not states.has(state_name):
        push_error("State '%s' not found" % state_name)
        return

    var previous_state := current_state
    previous_state.exit()
    previous_state.process_mode = Node.PROCESS_MODE_DISABLED

    current_state = states[state_name]
    current_state.process_mode = Node.PROCESS_MODE_INHERIT
    current_state.enter(msg)

    state_changed.emit(previous_state.name, current_state.name)
```

### 1.2 状态基类

```gdscript
# state.gd
class_name State
extends Node

var state_machine: StateMachine

func enter(_msg: Dictionary = {}) -> void:
    pass

func exit() -> void:
    pass

func update(_delta: float) -> void:
    pass

func physics_update(_delta: float) -> void:
    pass

func handle_input(_event: InputEvent) -> void:
    pass
```

## 2. 具体状态实现

### 2.1 玩家状态示例

```gdscript
# player_idle.gd
class_name PlayerIdle
extends State

@export var player: Player

func enter(_msg: Dictionary = {}) -> void:
    player.animation.play("idle")

func physics_update(_delta: float) -> void:
    var direction := Input.get_vector("left", "right", "up", "down")

    if direction != Vector2.ZERO:
        state_machine.transition_to("Move")

func handle_input(event: InputEvent) -> void:
    if event.is_action_pressed("attack"):
        state_machine.transition_to("Attack")
    elif event.is_action_pressed("jump"):
        state_machine.transition_to("Jump")
```

```gdscript
# player_move.gd
class_name PlayerMove
extends State

@export var player: Player

func enter(_msg: Dictionary = {}) -> void:
    player.animation.play("walk")

func physics_update(_delta: float) -> void:
    var direction := Input.get_vector("left", "right", "up", "down")

    if direction == Vector2.ZERO:
        state_machine.transition_to("Idle")
    elif Input.is_action_just_pressed("attack"):
        state_machine.transition_to("Attack")
```

```gdscript
# player_attack.gd
class_name PlayerAttack
extends State

@export var player: Player

var attack_cooldown: float = 0.3
var attack_timer: float = 0.0

func enter(_msg: Dictionary = {}) -> void:
    player.animation.play("attack")
    attack_timer = attack_cooldown

func physics_update(_delta: float) -> void:
    attack_timer -= _delta
    if attack_timer <= 0 and player.animation.current_animation == "attack":
        state_machine.transition_to("Idle")
```

## 3. 层级状态机

### 3.1 层级状态机实现

```gdscript
# hierarchical_state_machine.gd
class_name HierarchicalStateMachine
extends StateMachine

var parent_state: State

func init(parent: State) -> void:
    parent_state = parent
    for child in get_children():
        if child is State:
            child.state_machine = self
```

```gdscript
# state_with_substates.gd
class_name StateWithSubstates
extends State

@onready var hierarchical_fsm := HierarchicalStateMachine.new()

func enter(_msg: Dictionary = {}) -> void:
    hierarchical_fsm.init(self)
    add_child(hierarchical_fsm)
    hierarchical_fsm._ready()

func exit() -> void:
    hierarchical_fsm.current_state.exit()
    hierarchical_fsm.queue_free()
```

## 4. 状态模式选择

| 模式 | 适用场景 | 复杂度 |
|------|----------|--------|
| **简单状态机** | 状态较少、无嵌套 | 低 |
| **层级状态机** | 状态有共性、需要共享逻辑 | 中 |
| **下推自动机** | 状态需要堆栈管理（如战斗/逃跑） | 高 |

## 5. 设计模式总结

| 模式 | 应用场景 |
|------|----------|
| **状态模式** | 将每个状态封装为独立类 |
| **观察者模式** | `state_changed` 信号通知其他系统 |
| **模板方法** | 基类定义状态接口，子类实现具体行为 |
