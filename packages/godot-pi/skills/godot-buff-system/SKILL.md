---
name: godot-buff-system
description: Godot 4 Buff/status-effect system with Resource+Component (duration, stacks, DoT). Use when implementing buffs, debuffs, shields, or timed gameplay effects.
---

# Godot 4 Buff系统

完整的Buff/状态效果系统，支持增益和减益效果、持续时间、循环触发、层叠管理等。

## 何时使用此技能

- 实现游戏状态效果系统
- 玩家/敌人增益减益管理
- DOT/AOE持续伤害
- 护盾、回复、加速等效果

## 架构设计

### Resource + Component 架构

```
Buff系统
├── Buff Resource（数据层）
│   ├── BuffData - Buff定义数据
│   └── BuffStack - 运行时Buff实例
├── BuffComponent（逻辑层）
│   ├── BuffStore - Buff注册中心
│   └── BuffTimer - 时间管理
└── BuffEffect（效果层）
    └── 各种效果实现
```

### 分层职责

- **BuffData**: 定义Buff的静态属性（名称、持续时间、效果类型等）
- **BuffStack**: 管理Buff实例的运行时状态（当前层数、剩余时间等）
- **BuffComponent**: 挂在目标身上，执行Buff逻辑

## Buff数据结构

### BuffData Buff定义资源

```gdscript
# buff_data.gd
class_name BuffData
extends Resource

## Buff唯一标识符
@export var id: StringName

## Buff显示名称
@export var buff_name: String

## Buff描述
@export_multiline var description: String

## Buff图标
@export var icon: Texture2D

## 持续时间（秒），0表示永久
@export var duration: float = 0.0

## 循环间隔（秒），0表示不循环
@export var tick_interval: float = 0.0

## 最大层数
@export var max_stack: int = 1

## 层叠方式
@export_enum("None", "Duration", "Intensity", "Both") var stack_type: int = 0

## 效果类型
@export_enum("Beneficial", "Harmful", "Neutral") var buff_type: int = 0

## 是否可以被驱散
@export var can_be_dispelled: bool = true

## 是否显示在UI上
@export var show_in_ui: bool = true

## 效果生效时调用
@export var effect_script: GDScript

## Buff优先级（高优先级先执行）
@export var priority: int = 0
```

### BuffStack Buff实例

```gdscript
# buff_stack.gd
class_name BuffStack
extends RefCounted

## 所属的Buff数据
var buff_data: BuffData

## 当前层数
var current_stack: int = 1

## 剩余时间
var remaining_time: float

## 是否正在运行
var is_active: bool = false

## 父节点（BuffComponent持有者）
var owner_node: Node

## 内部计时器
var _tick_timer: float = 0.0

signal stack_changed(new_stack: int)
signal buff_ended(buff_id: StringName)
signal tick_elapsed

func _init(data: BuffData, owner: Node) -> void:
    buff_data = data
    owner_node = owner
    remaining_time = data.duration
    _tick_timer = data.tick_interval

func start() -> void:
    is_active = true
    _apply_effect()

func stop() -> void:
    is_active = false
    _remove_effect()
    buff_ended.emit(buff_data.id)

func update(delta: float) -> bool:
    if not is_active:
        return false
    
    # 更新剩余时间
    remaining_time -= delta
    
    # 循环效果
    if buff_data.tick_interval > 0:
        _tick_timer -= delta
        if _tick_timer <= 0:
            _tick_timer = buff_data.tick_interval
            _on_tick()
            tick_elapsed.emit()
    
    # 永久Buff
    if buff_data.duration <= 0:
        return true
    
    # 时间到则结束
    if remaining_time <= 0:
        stop()
        return false
    
    return true

func add_stack(amount: int = 1) -> void:
    var new_stack := mini(current_stack + amount, buff_data.max_stack)
    
    match buff_data.stack_type:
        1: # Duration - 刷新持续时间
            remaining_time = buff_data.duration
        2: # Intensity - 增加层数
            current_stack = new_stack
            _apply_effect()  # 重新应用效果
        3: # Both - 刷新时间并增加层数
            remaining_time = buff_data.duration
            current_stack = new_stack
            _apply_effect()
        _:
            current_stack = new_stack
    
    stack_changed.emit(current_stack)

func _apply_effect() -> void:
    if buff_data.effect_script:
        # 执行效果脚本
        pass

func _remove_effect() -> void:
    if buff_data.effect_script:
        # 移除效果脚本
        pass

func _on_tick() -> void:
    # 每次循环时调用
    pass

func get_time_percent() -> float:
    if buff_data.duration <= 0:
        return 1.0
    return remaining_time / buff_data.duration
```

## 效果执行机制

### BuffStore 注册中心

```gdscript
# buff_store.gd
class_name BuffStore
extends Node

## 注册所有可用的Buff
@export var registered_buffs: Array[BuffData]

## 全局Buff字典
var _buff_registry: Dictionary = {}

func _ready() -> void:
    _register_all_buffs()

func _register_all_buffs() -> void:
    for buff in registered_buffs:
        _buff_registry[buff.id] = buff

func get_buff_data(buff_id: StringName) -> BuffData:
    return _buff_registry.get(buff_id)

func create_buff_stack(buff_id: StringName, owner: Node) -> BuffStack:
    var data := get_buff_data(buff_id)
    if data == null:
        push_error("Buff not found: ", buff_id)
        return null
    
    var stack := BuffStack.new(data, owner)
    return stack
```

### BuffComponent Buff组件

```gdscript
# buff_component.gd
class_name BuffComponent
extends Node

## 信号：Buff被添加
signal buff_added(buff_id: StringName, stack: BuffStack)

## 信号：Buff被移除
signal buff_removed(buff_id: StringName)

## 信号：Buff层数变化
signal buff_stack_changed(buff_id: StringName, new_stack: int)

## 信号：Buff刷新
signal buff_refreshed(buff_id: StringName)

## 活跃的Buff字典
var active_buffs: Dictionary = {}

## 父节点引用
var _owner: Node

func _ready() -> void:
    _owner = get_parent()

func _process(delta: float) -> void:
    _update_buffs(delta)

func _update_buffs(delta: float) -> void:
    var to_remove: Array[StringName] = []
    
    for buff_id in active_buffs.keys():
        var stack: BuffStack = active_buffs[buff_id]
        if not stack.update(delta):
            to_remove.append(buff_id)
    
    for buff_id in to_remove:
        _remove_buff(buff_id)

## 添加Buff
func add_buff(buff_id: StringName, duration: float = -1) -> BuffStack:
    # 检查是否已存在
    if active_buffs.has(buff_id):
        var existing: BuffStack = active_buffs[buff_id]
        existing.add_stack(1)
        if duration > 0:
            existing.remaining_time = duration
        buff_refreshed.emit(buff_id)
        return existing
    
    # 创建新Buff
    var stack := BuffStore.create_buff_stack(buff_id, _owner)
    if stack == null:
        return null
    
    if duration > 0:
        stack.buff_data.duration = duration
    
    active_buffs[buff_id] = stack
    stack.start()
    
    buff_added.emit(buff_id, stack)
    return stack

## 移除Buff
func remove_buff(buff_id: StringName) -> bool:
    if not active_buffs.has(buff_id):
        return false
    
    var stack: BuffStack = active_buffs[buff_id]
    stack.stop()
    active_buffs.erase(buff_id)
    
    buff_removed.emit(buff_id)
    return true

## 清除所有指定类型的Buff
func remove_buffs_by_type(buff_type: int) -> void:
    var to_remove: Array[StringName] = []
    
    for buff_id in active_buffs.keys():
        var stack: BuffStack = active_buffs[buff_id]
        if stack.buff_data.buff_type == buff_type:
            to_remove.append(buff_id)
    
    for buff_id in to_remove:
        remove_buff(buff_id)

## 清除所有可驱散的减益Buff
func dispel_harmful() -> int:
    var count := 0
    var to_remove: Array[StringName] = []
    
    for buff_id in active_buffs.keys():
        var stack: BuffStack = active_buffs[buff_id]
        if stack.buff_data.buff_type == 1 and stack.buff_data.can_be_dispelled:  # Harmful
            to_remove.append(buff_id)
    
    for buff_id in to_remove:
        remove_buff(buff_id)
        count += 1
    
    return count

## 获取当前层数
func get_buff_stack(buff_id: StringName) -> int:
    if active_buffs.has(buff_id):
        return active_buffs[buff_id].current_stack
    return 0

## 是否有指定Buff
func has_buff(buff_id: StringName) -> bool:
    return active_buffs.has(buff_id)

## 获取所有活跃Buff
func get_all_buffs() -> Array[BuffStack]:
    return active_buffs.values()

## 获取指定类型的Buff
func get_buffs_by_type(buff_type: int) -> Array[BuffStack]:
    var result: Array[BuffStack] = []
    for stack in active_buffs.values():
        if stack.buff_data.buff_type == buff_type:
            result.append(stack)
    return result
```

## 时间机制

### 持续时间处理

```gdscript
# 持续时间逻辑
func update(delta: float) -> bool:
    remaining_time -= delta
    if remaining_time <= 0:
        stop()
        return false
    return true
```

### 循环触发机制

```gdscript
# 循环效果示例 - 持续伤害
class_name DOTBuffStack
extends BuffStack

var damage_per_tick: float

func _init(data: BuffData, owner: Node, damage: float):
    super(data, owner)
    damage_per_tick = damage

func _on_tick() -> void:
    if owner_node.has_method("take_damage"):
        owner_node.take_damage(damage_per_tick * current_stack)
```

### 定时器管理

```gdscript
# buff_timer_manager.gd
class_name BuffTimerManager
extends Node

## 全局定时器管理，避免每个Buff单独创建Timer
var _timers: Dictionary = {}

func add_timer(buff_id: StringName, interval: float, callback: Callable) -> void:
    if _timers.has(buff_id):
        return
    
    var timer := Timer.new()
    timer.wait_time = interval
    timer.autostart = true
    timer.timeout.connect(callback)
    add_child(timer)
    _timers[buff_id] = timer

func remove_timer(buff_id: StringName) -> void:
    if _timers.has(buff_id):
        var timer: Timer = _timers[buff_id]
        timer.stop()
        timer.queue_free()
        _timers.erase(buff_id)

func clear_all() -> void:
    for timer in _timers.values():
        timer.stop()
        timer.queue_free()
    _timers.clear()
```

## 移除机制

### 手动移除

```gdscript
func remove_buff(buff_id: StringName) -> bool:
    if not active_buffs.has(buff_id):
        return false
    
    var stack: BuffStack = active_buffs[buff_id]
    stack.stop()
    active_buffs.erase(buff_id)
    
    return true
```

### 条件移除

```gdscript
# 特定条件触发移除
func check_removal_conditions() -> void:
    for buff_id in active_buffs.keys():
        var stack: BuffStack = active_buffs[buff_id]
        
        # 示例：生命值低于阈值移除增益
        if stack.buff_data.buff_type == 0:  # Beneficial
            if _owner.health < 10:
                remove_buff(buff_id)
```

### 死亡移除

```gdscript
# 死亡时清除减益
func _on_owner_died() -> void:
    remove_buffs_by_type(1)  # Harmful buffs
```

## 实际效果实现示例

### 护盾效果

```gdscript
# shield_buff.gd
class_name ShieldBuffData
extends BuffData

@export var shield_amount: float = 50.0

func _init():
    super()
    buff_name = "护盾"
    description = "获得临时护盾，吸收伤害"
    duration = 10.0
    buff_type = 0  # Beneficial
```

```gdscript
# shield_effect.gd
class_name ShieldEffect
extends Node

var shield_component: Node
var shield_amount: float

func apply(target: Node, amount: float) -> void:
    if target.has_node("ShieldComponent"):
        shield_component = target.get_node("ShieldComponent")
    else:
        shield_component = Node.new()
        shield_component.set_script(load("res://shield_component.gd"))
        target.add_child(shield_component)
    
    shield_component.add_shield(amount)

func remove(target: Node) -> void:
    if target.has_node("ShieldComponent"):
        target.get_node("ShieldComponent").clear_shield()
```

### 攻击加速效果

```gdscript
# attack_speed_buff.gd
class_name AttackSpeedBuffData
extends BuffData

@export var speed_multiplier: float = 1.5

func _init():
    super()
    buff_name = "攻击加速"
    description = "攻击速度提升50%"
    duration = 5.0
    buff_type = 0  # Beneficial
    max_stack = 3
    stack_type = 2  # Intensity
```

### 持续伤害效果

```gdscript
# dot_buff.gd
class_name DOTBuffData
extends BuffData

@export var damage_per_tick: float = 5.0
@export var tick_interval: float = 1.0

func _init():
    super()
    buff_name = "灼烧"
    description = "每秒受到伤害"
    duration = 5.0
    tick_interval = 1.0
    buff_type = 1  # Harmful
```

```gdscript
# dot_buff_stack.gd
class_name DOTBuffStack
extends BuffStack

var damage_per_tick: float

func _init(data: BuffData, owner: Node, damage: float):
    super(data, owner)
    damage_per_tick = damage

func _on_tick() -> void:
    if owner_node.has_method("take_damage"):
        owner_node.take_damage(damage_per_tick * current_stack)
```

## 使用示例

### 玩家角色

```gdscript
# player.gd
extends CharacterBody2D

@export var buff_component: BuffComponent

func take_damage(amount: float) -> void:
    # 检查护盾
    if has_node("ShieldComponent"):
        var shield: Node = get_node("ShieldComponent")
        amount = shield.absorb(amount)
    
    _health -= amount
    
    if _health <= 0:
        die()

func _ready() -> void:
    buff_component = BuffComponent.new()
    add_child(buff_component)

func apply_poison() -> void:
    var poison_data := BuffStore.get_buff_data("poison")
    if poison_data:
        buff_component.add_buff("poison")
```

### 应用Buff

```gdscript
# 使用示例
func use_item(item: InventoryItem) -> void:
    match item.id:
        "health_potion":
            player.buff_component.add_buff("healing", 5.0)
        "speed_boost":
            player.buff_component.add_buff("speed_up", 10.0)
```

## UI集成

### Buff图标显示

```gdscript
# buff_icon_ui.gd
class_name BuffIconUI
extends Control

@export var icon_texture: TextureRect
@export var time_label: Label
@export var stack_label: Label
@export var duration_bar: ProgressBar

var buff_stack: BuffStack

func set_buff(stack: BuffStack) -> void:
    buff_stack = stack
    _update_display()
    
    stack.stack_changed.connect(_on_stack_changed)
    stack.buff_ended.connect(_on_buff_ended)

func _update_display() -> void:
    if buff_stack == null:
        return
    
    icon_texture.texture = buff_stack.buff_data.icon
    
    if buff_stack.buff_data.duration > 0:
        time_label.text = "%.1f" % buff_stack.remaining_time
        duration_bar.value = buff_stack.get_time_percent() * 100
    
    if buff_stack.current_stack > 1:
        stack_label.text = "x%d" % buff_stack.current_stack
        stack_label.visible = true

func _on_stack_changed(new_stack: int) -> void:
    stack_label.text = "x%d" % new_stack

func _on_buff_ended(_buff_id: StringName) -> void:
    queue_free()
```

## 最佳实践

1. **Resource存储静态数据** - BuffData作为Resource便于编辑器配置
2. **Component管理运行时** - BuffComponent统一管理生命周期
3. **使用RefCounted** - BuffStack继承RefCounted自动管理内存
4. **优先级处理** - 高优先级Buff先执行
5. **循环池化** - 避免频繁创建Timer节点
6. **信号解耦** - UI通过信号监听变化，不直接查询
