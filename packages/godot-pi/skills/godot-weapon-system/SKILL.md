---
name: godot-weapon-system
description: Godot 4 weapon switching: types, base class, input binds, cooldown locks. Use when implementing weapon loadouts, melee/ranged swap, or weapon cooldowns.
---

# Godot 4 武器切换系统

完整的武器管理系统，支持多类型武器、快速切换、冷却锁定、输入绑定。

## 何时使用此技能

- 实现玩家武器切换
- 近战/远程武器系统
- 武器冷却与锁定
- 武器类型分类管理

## 武器类型枚举

```gdscript
# weapon_type.gd
class_name WeaponType
extends RefCounted

## 武器类型枚举
enum Type {
    NONE = -1,
    SWORD = 0,      # 近战 - 剑
    AXE = 1,        # 近战 - 斧
    HAMMER = 2,     # 近战 - 锤
    BOW = 3,        # 远程 - 弓
    CROSSBOW = 4,   # 远程 - 弩
    STAFF = 5,      # 法杖
    SHIELD = 6,     # 盾牌
    THROWING = 7,   # 投掷武器
}

## 类型名称映射
const TYPE_NAMES: Dictionary = {
    Type.SWORD: "剑",
    Type.AXE: "斧",
    Type.HAMMER: "锤",
    Type.BOW: "弓",
    Type.CROSSBOW: "弩",
    Type.STAFF: "法杖",
    Type.SHIELD: "盾牌",
    Type.THROWING: "投掷武器"
}

## 获取类型名称
static func get_name(type: Type) -> String:
    return TYPE_NAMES.get(type, "未知")

## 是否是近战武器
static func is_melee(type: Type) -> bool:
    return type in [Type.SWORD, Type.AXE, Type.HAMMER, Type.SHIELD]

## 是否是远程武器
static func is_ranged(type: Type) -> bool:
    return type in [Type.BOW, Type.CROSSBOW, Type.STAFF, Type.THROWING]
```

## 武器基类设计

### WeaponData 武器数据资源

```gdscript
# weapon_data.gd
class_name WeaponData
extends Resource

## 武器唯一标识符
@export var id: StringName

## 武器名称
@export var weapon_name: String

## 武器类型
@export var weapon_type: WeaponType.Type = WeaponType.Type.SWORD

## 武器 Prefab 场景
@export var weapon_scene: PackedScene

## 武器图标（用于UI）
@export var icon: Texture2D

## 基础属性
@export var base_damage: int = 10
@export var attack_speed: float = 1.0
@export var attack_range: float = 1.0

## 冷却时间
@export var cooldown: float = 0.5

## 是否需要弹药
@export var needs_ammo: bool = false
@export var max_ammo: int = 0
@export var ammo_type: StringName = &""

## 特殊属性
@export var can_block: bool = false
@export var block_ratio: float = 0.5

## 动画
@export var attack_animation: StringName = &"attack"
@export var idle_animation: StringName = &"idle"

## 获取武器类型名称
func get_type_name() -> String:
    return WeaponType.get_name(weapon_type)

## 是否是近战武器
func is_melee() -> bool:
    return WeaponType.is_melee(weapon_type)

## 是否是远程武器
func is_ranged() -> bool:
    return WeaponType.is_ranged(weapon_type)
```

### Weapon 基类

```gdscript
# weapon.gd
class_name Weapon
extends Node2D

## 信号：攻击开始
signal attack_started

## 信号：攻击结束
signal attack_finished

## 信号：攻击命中
signal attack_hit(target: Node)

## 信号：弹药变化
signal ammo_changed(current: int, max: int)

@export var weapon_data: WeaponData

var _owner: CharacterBody2D
var _current_ammo: int
var _cooldown_timer: float = 0.0
var _is_attacking: bool = false

func _ready() -> void:
    _owner = get_owner() as CharacterBody2D
    if weapon_data and weapon_data.needs_ammo:
        _current_ammo = weapon_data.max_ammo
        ammo_changed.emit(_current_ammo, weapon_data.max_ammo)

func _process(delta: float) -> void:
    if _cooldown_timer > 0:
        _cooldown_timer -= delta

func _physics_process(delta: float) -> void:
    pass

## 使用武器攻击
func attack() -> bool:
    if not can_attack():
        return false
    
    if weapon_data.needs_ammo and _current_ammo <= 0:
        return false
    
    _is_attacking = true
    _start_attack()
    attack_started.emit()
    
    if weapon_data.needs_ammo:
        _current_ammo -= 1
        ammo_changed.emit(_current_ammo, weapon_data.max_ammo)
    
    # 重置冷却
    _cooldown_timer = weapon_data.cooldown
    
    return true

func _start_attack() -> void:
    # 播放攻击动画
    if _owner.has_method("play_animation"):
        _owner.play_animation(weapon_data.attack_animation)

func _end_attack() -> void:
    _is_attacking = false
    attack_finished.emit()

## 停止攻击
func stop_attack() -> void:
    _is_attacking = false
    _end_attack()

## 是否可以攻击
func can_attack() -> bool:
    if _is_attacking:
        return false
    if _cooldown_timer > 0:
        return false
    return true

## 获取剩余冷却时间
func get_cooldown_remaining() -> float:
    return maxf(_cooldown_timer, 0.0)

## 装填弹药
func reload(amount: int = 0) -> void:
    if not weapon_data.needs_ammo:
        return
    
    if amount <= 0:
        _current_ammo = weapon_data.max_ammo
    else:
        _current_ammo = mini(_current_ammo + amount, weapon_data.max_ammo)
    
    ammo_changed.emit(_current_ammo, weapon_data.max_ammo)

## 命中处理（供Hitbox调用）
func on_hit(target: Node) -> void:
    attack_hit.emit(target)
```

### 具体武器实现

```gdscript
# sword.gd
class_name Sword
extends Weapon

@export var slash_effect_scene: PackedScene

func _start_attack() -> void:
    super._start_attack()
    
    # 生成斩击特效
    if slash_effect_scene:
        var effect := slash_effect_scene.instantiate()
        get_tree().current_scene.add_child(effect)
        effect.global_position = global_position
        effect.rotation = _owner.rotation

func on_hit(target: Node) -> void:
    if target.has_method("take_damage"):
        target.take_damage(weapon_data.base_damage)
    
    # 击退效果
    if target.has_method("apply_knockback"):
        var direction := (target.global_position - _owner.global_position).normalized()
        target.apply_knockback(direction, 200.0)
```

```gdscript
# bow.gd
class_name Bow
extends Weapon

@export var arrow_scene: PackedScene
@export var arrow_spawn_offset: Vector2 = Vector2(30, 0)

func _start_attack() -> void:
    super._start_attack()
    
    # 发射箭矢
    if arrow_scene:
        var arrow := arrow_scene.instantiate()
        get_tree().current_scene.add_child(arrow)
        
        var spawn_pos := global_position + arrow_spawn_offset.rotated(global_rotation)
        arrow.initialize(spawn_pos, _owner.rotation, weapon_data.base_damage)
```

## 切换逻辑

### WeaponSwitcher 武器切换器

```gdscript
# weapon_switcher.gd
class_name WeaponSwitcher
extends Node

## 信号：武器切换
signal weapon_switched(from_weapon: Weapon, to_weapon: Weapon)

## 信号：武器被锁定
signal weapon_locked(weapon_type: WeaponType.Type, unlock_time: float)

## 信号：切换冷却开始
signal switch_cooldown_started(duration: float)

@export var weapon_slots: Array[WeaponData] = []
@export var max_secondary_weapons: int = 2

## 当前激活的武器索引
var current_weapon_index: int = -1

## 当前武器引用
var current_weapon: Weapon = null

## 武器节点字典
var _weapon_nodes: Dictionary = {}

## 切换冷却
var _switch_cooldown: float = 0.3
var _is_locked: bool = false
var _lock_until: float = 0.0

## 武器类型到索引的映射
var _type_to_index: Dictionary = {}

func _ready() -> void:
    _initialize_weapons()

func _process(delta: float) -> void:
    _update_cooldown(delta)
    _update_lock(delta)

func _update_cooldown(delta: float) -> void:
    if _switch_cooldown > 0:
        _switch_cooldown -= delta

func _update_lock(delta: float) -> void:
    if _is_locked and Time.get_ticks_msec() / 1000.0 >= _lock_until:
        _is_locked = false

func _initialize_weapons() -> void:
    # 创建所有武器节点
    for i in weapon_slots.size():
        var data: WeaponData = weapon_slots[i]
        if data.weapon_scene == null:
            continue
        
        var weapon: Weapon = data.weapon_scene.instantiate()
        weapon.weapon_data = data
        weapon.set_process(false)
        weapon.visible = false
        add_child(weapon)
        _weapon_nodes[i] = weapon
        
        # 建立类型映射
        _type_to_index[data.weapon_type] = i
    
    # 默认装备第一把武器
    if weapon_slots.size() > 0:
        _equip_weapon(0)

## 切换到指定索引的武器
func switch_to_index(index: int) -> bool:
    if index < 0 or index >= weapon_slots.size():
        return false
    
    if index == current_weapon_index:
        return true
    
    if not can_switch():
        return false
    
    _switch_cooldown = 0.3
    switch_cooldown_started.emit(_switch_cooldown)
    
    var previous := current_weapon
    _unequip_current()
    _equip_weapon(index)
    
    weapon_switched.emit(previous, current_weapon)
    return true

## 切换到指定类型
func switch_to_type(weapon_type: WeaponType.Type) -> bool:
    if _type_to_index.has(weapon_type):
        return switch_to_index(_type_to_index[weapon_type])
    return false

## 切换到下一把武器（循环）
func switch_to_next() -> bool:
    if weapon_slots.size() <= 1:
        return false
    
    var next_index := (current_weapon_index + 1) % weapon_slots.size()
    return switch_to_index(next_index)

## 切换到上一把武器（循环）
func switch_to_previous() -> bool:
    if weapon_slots.size() <= 1:
        return false
    
    var prev_index := (current_weapon_index - 1 + weapon_slots.size()) % weapon_slots.size()
    return switch_to_index(prev_index)

## 卸下当前武器
func _unequip_current() -> void:
    if current_weapon != null:
        current_weapon.set_process(false)
        current_weapon.visible = false
        current_weapon.stop_attack()

## 装备武器
func _equip_weapon(index: int) -> void:
    current_weapon_index = index
    current_weapon = _weapon_nodes.get(index)
    
    if current_weapon != null:
        current_weapon.visible = true
        current_weapon.set_process(true)

## 是否可以切换
func can_switch() -> bool:
    if _switch_cooldown > 0:
        return false
    if _is_locked:
        return false
    if current_weapon != null and current_weapon._is_attacking:
        return false
    return true

## 锁定特定类型武器
func lock_weapon_type(weapon_type: WeaponType.Type, duration: float) -> void:
    _is_locked = true
    _lock_until = Time.get_ticks_msec() / 1000.0 + duration
    weapon_locked.emit(weapon_type, duration)

## 解锁武器类型
func unlock_weapon_type(weapon_type: WeaponType.Type) -> void:
    _is_locked = false

## 获取当前武器数据
func get_current_weapon_data() -> WeaponData:
    if current_weapon_index >= 0 and current_weapon_index < weapon_slots.size():
        return weapon_slots[current_weapon_index]
    return null

## 获取当前武器类型
func get_current_weapon_type() -> WeaponType.Type:
    var data := get_current_weapon_data()
    if data != null:
        return data.weapon_type
    return WeaponType.Type.NONE

## 添加武器到槽位
func add_weapon(data: WeaponData) -> bool:
    if weapon_slots.size() >= max_secondary_weapons + 1:
        return false
    
    weapon_slots.append(data)
    var index := weapon_slots.size() - 1
    
    var weapon: Weapon = data.weapon_scene.instantiate()
    weapon.weapon_data = data
    weapon.set_process(false)
    weapon.visible = false
    add_child(weapon)
    _weapon_nodes[index] = weapon
    _type_to_index[data.weapon_type] = index
    
    return true

## 移除武器
func remove_weapon(index: int) -> bool:
    if index < 0 or index >= weapon_slots.size():
        return false
    
    # 如果是当前武器，切换到另一把
    if index == current_weapon_index:
        var next_index := (index + 1) % weapon_slots.size()
        if next_index != index:
            switch_to_index(next_index)
        else:
            _unequip_current()
            current_weapon_index = -1
            current_weapon = null
    
    weapon_slots.remove_at(index)
    _weapon_nodes.erase(index)
    
    return true
```

## 输入绑定

### 输入映射配置

```gdscript
# weapon_input_handler.gd
class_name WeaponInputHandler
extends Node

@export var weapon_switcher: WeaponSwitcher

## 输入映射名称
const INPUT_SLOT_1 := "weapon_slot_1"
const INPUT_SLOT_2 := "weapon_slot_2"
const INPUT_SLOT_3 := "weapon_slot_3"
const INPUT_SLOT_4 := "weapon_slot_4"
const INPUT_SLOT_5 := "weapon_slot_5"
const INPUT_NEXT_WEAPON := "next_weapon"
const INPUT_PREV_WEAPON := "prev_weapon"
const INPUT_ATTACK := "attack"
const INPUT_BLOCK := "block"
const INPUT_RELOAD := "reload"

func _ready() -> void:
    _setup_input_actions()

func _unhandled_input(event: InputEvent) -> void:
    # 攻击
    if event.is_action_pressed(INPUT_ATTACK):
        _on_attack_pressed()
    elif event.is_action_released(INPUT_ATTACK):
        _on_attack_released()
    
    # 格挡
    elif event.is_action_pressed(INPUT_BLOCK):
        _on_block_pressed()
    elif event.is_action_released(INPUT_BLOCK):
        _on_block_released()
    
    # 切换武器
    elif event.is_action_pressed(INPUT_SLOT_1):
        weapon_switcher.switch_to_index(0)
    elif event.is_action_pressed(INPUT_SLOT_2):
        weapon_switcher.switch_to_index(1)
    elif event.is_action_pressed(INPUT_SLOT_3):
        weapon_switcher.switch_to_index(2)
    elif event.is_action_pressed(INPUT_SLOT_4):
        weapon_switcher.switch_to_index(3)
    elif event.is_action_pressed(INPUT_SLOT_5):
        weapon_switcher.switch_to_index(4)
    
    # 循环切换
    elif event.is_action_pressed(INPUT_NEXT_WEAPON):
        weapon_switcher.switch_to_next()
    elif event.is_action_pressed(INPUT_PREV_WEAPON):
        weapon_switcher.switch_to_previous()
    
    # 换弹
    elif event.is_action_pressed(INPUT_RELOAD):
        _on_reload_pressed()

func _setup_input_actions() -> void:
    # 在ProjectSettings中设置这些输入映射
    # 或者动态创建
    pass

func _on_attack_pressed() -> void:
    if weapon_switcher.current_weapon != null:
        weapon_switcher.current_weapon.attack()

func _on_attack_released() -> void:
    if weapon_switcher.current_weapon != null:
        weapon_switcher.current_weapon.stop_attack()

func _on_block_pressed() -> void:
    var data := weapon_switcher.get_current_weapon_data()
    if data != null and data.can_block:
        # 播放格挡动画
        pass

func _on_block_released() -> void:
    pass

func _on_reload_pressed() -> void:
    if weapon_switcher.current_weapon != null:
        weapon_switcher.current_weapon.reload()
```

### ProjectSettings 输入配置

```
[input]

attack = {
    "deadzone": 0.5,
    "events": [ Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":0,"physical_keycode":69,"key_label":0,"unicode":101,"echo":false,"script":null)
 ]
}
block = {
    "deadzone": 0.5,
    "events": [ Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":0,"physical_keycode":70,"key_label":0,"unicode":102,"echo":false,"script":null)
 ]
}
reload = {
    "deadzone": 0.5,
    "events": [ Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":0,"physical_keycode":82,"key_label":0,"unicode":114,"echo":false,"script":null)
 ]
}
next_weapon = {
    "deadzone": 0.5,
    "events": [ Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":0,"physical_keycode":81,"key_label":0,"unicode":113,"echo":false,"script":null)
 ]
}
prev_weapon = {
    "deadzone": 0.5,
    "events": [ Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":0,"physical_keycode":90,"key_label":0,"unicode":122,"echo":false,"script":null)
 ]
}
weapon_slot_1 = {
    "deadzone": 0.5,
    "events": [ Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":0,"physical_keycode":49,"key_label":0,"unicode":49,"echo":false,"script":null)
 ]
}
weapon_slot_2 = {
    "deadzone": 0.5,
    "events": [ Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":0,"physical_keycode":50,"key_label":0,"unicode":50,"echo":false,"script":null)
 ]
}
weapon_slot_3 = {
    "deadzone": 0.5,
    "events": [ Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":0,"physical_keycode":51,"key_label":0,"unicode":51,"echo":false,"script":null)
 ]
}
```

## 锁定机制

### 武器锁定系统

```gdscript
# weapon_lock_manager.gd
class_name WeaponLockManager
extends Node

## 锁定信息
class LockInfo:
    var weapon_type: WeaponType.Type
    var unlock_time: float
    var reason: String
    
    func _init(type: WeaponType.Type, time: float, reason_str: String):
        weapon_type = type
        unlock_time = time
        reason = reason_str

var _locks: Dictionary = {}  # weapon_type -> LockInfo

func _process(delta: float) -> void:
    _check_locks(delta)

func _check_locks(delta: float) -> void:
    var current_time := Time.get_ticks_msec() / 1000.0
    var to_remove: Array
    
    for type in _locks.keys():
        var lock: LockInfo = _locks[type]
        if current_time >= lock.unlock_time:
            to_remove.append(type)
    
    for type in to_remove:
        _locks.erase(type)

## 锁定武器类型
func lock(weapon_type: WeaponType.Type, duration: float, reason: String = "") -> void:
    var unlock_time := Time.get_ticks_msec() / 1000.0 + duration
    _locks[weapon_type] = LockInfo.new(weapon_type, unlock_time, reason)

## 解锁武器类型
func unlock(weapon_type: WeaponType.Type) -> void:
    _locks.erase(weapon_type)

## 是否被锁定
func is_locked(weapon_type: WeaponType.Type) -> bool:
    return _locks.has(weapon_type)

## 获取剩余锁定时间
func get_remaining_lock_time(weapon_type: WeaponType.Type) -> float:
    if not _locks.has(weapon_type):
        return 0.0
    
    var current_time := Time.get_ticks_msec() / 1000.0
    var unlock_time: float = _locks[weapon_type].unlock_time
    return maxf(unlock_time - current_time, 0.0)

## 锁定时触发（用于UI提示）
func _on_weapon_locked(weapon_type: WeaponType.Type, remaining: float) -> void:
    print("武器类型 %s 被锁定，剩余时间: %.1f秒" % [WeaponType.get_name(weapon_type), remaining])
```

### 使用场景

```gdscript
# 玩家被眩晕时锁定武器
func _on_player_stunned(duration: float) -> void:
    var current_type := weapon_switcher.get_current_weapon_type()
    weapon_lock_manager.lock(current_type, duration, "眩晕")
    
    # 停止当前攻击
    weapon_switcher.current_weapon.stop_attack()

# 武器切换冷却
func _on_switch_cooldown_started(duration: float) -> void:
    # 更新UI冷却显示
    ui.update_weapon_switch_cooldown(duration)
```

## UI集成

### 武器栏UI

```gdscript
# weapon_bar_ui.gd
class_name WeaponBarUI
extends Control

@export var weapon_switcher: WeaponSwitcher
@export var slot_scene: PackedScene

@onready var slots_container: HBoxContainer = %SlotsContainer

var slotuis: Array[WeaponSlotUI] = []

func _ready() -> void:
    weapon_switcher.weapon_switched.connect(_on_weapon_switched)
    weapon_switcher.weapon_locked.connect(_on_weapon_locked)
    weapon_switcher.switch_cooldown_started.connect(_on_switch_cooldown)
    
    _create_slots()

func _create_slots() -> void:
    for i in weapon_switcher.weapon_slots.size():
        var slot: WeaponSlotUI = slot_scene.instantiate()
        slot.slot_index = i
        slot.clicked.connect(_on_slot_clicked)
        slots_container.add_child(slot)
        slotuis.append(slot)
    
    _update_all_slots()

func _update_all_slots() -> void:
    for i in slotuis.size():
        var data: WeaponData = weapon_switcher.weapon_slots[i]
        slotuis[i].set_weapon_data(data)
        slotuis[i].set_selected(i == weapon_switcher.current_weapon_index)

func _on_weapon_switched(from: Weapon, to: Weapon) -> void:
    _update_all_slots()

func _on_weapon_locked(weapon_type: WeaponType.Type, unlock_time: float) -> void:
    # 更新对应类型的槽位显示锁定状态
    for slot in slotuis:
        var data: WeaponData = weapon_switcher.weapon_slots[slot.slot_index]
        if data.weapon_type == weapon_type:
            slot.set_locked(true, unlock_time)

func _on_switch_cooldown(duration: float) -> void:
    # 显示切换冷却
    for slot in slotuis:
        slot.start_cooldown(duration)

func _on_slot_clicked(index: int) -> void:
    weapon_switcher.switch_to_index(index)
```

### 武器槽UI

```gdscript
# weapon_slot_ui.gd
class_name WeaponSlotUI
extends PanelContainer

signal clicked(slot_index: int)

@export var slot_index: int = 0

@onready var icon_texture: TextureRect = %IconTexture
@onready var key_label: Label = %KeyLabel
@onready var lock_icon: TextureRect = %LockIcon
@onready var cooldown_overlay: ColorRect = %CooldownOverlay
@onready var selected_border: PanelContainer = %SelectedBorder

var _is_selected: bool = false
var _is_locked: bool = false
var _cooldown_timer: float = 0.0

func _ready() -> void:
    gui_input.connect(_on_gui_input)
    mouse_entered.connect(_on_mouse_entered)
    mouse_exited.connect(_on_mouse_exited)

func _process(delta: float) -> void:
    _update_cooldown(delta)

func set_weapon_data(data: WeaponData) -> void:
    if data != null and data.icon != null:
        icon_texture.texture = data.icon
    else:
        icon_texture.texture = null
    
    # 显示快捷键
    key_label.text = "%d" % (slot_index + 1)

func set_selected(selected: bool) -> void:
    _is_selected = selected
    selected_border.visible = selected

func set_locked(locked: bool, _unlock_time: float) -> void:
    _is_locked = locked
    lock_icon.visible = locked

func start_cooldown(duration: float) -> void:
    _cooldown_timer = duration
    cooldown_overlay.visible = true

func _update_cooldown(delta: float) -> void:
    if _cooldown_timer > 0:
        _cooldown_timer -= delta
        cooldown_overlay.modulate.a = _cooldown_timer / 0.3  # 假设冷却0.3秒
        if _cooldown_timer <= 0:
            cooldown_overlay.visible = false

func _on_gui_input(event: InputEvent) -> void:
    if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT and event.pressed:
        clicked.emit(slot_index)

func _on_mouse_entered() -> void:
    modulate = Color(1.2, 1.2, 1.2)

func _on_mouse_exited() -> void:
    modulate = Color(1.0, 1.0, 1.0)
```

## 使用示例

### 玩家角色

```gdscript
# player.gd
extends CharacterBody2D

@export var weapon_switcher: WeaponSwitcher
@export var weapon_input_handler: WeaponInputHandler
@export var weapon_lock_manager: WeaponLockManager

func _ready() -> void:
    # 初始化武器
    weapon_switcher.add_weapon(weapon_database.get_weapon("sword"))
    weapon_switcher.add_weapon(weapon_database.get_weapon("bow"))
    weapon_switcher.add_weapon(weapon_database.get_weapon("shield"))

func take_damage(amount: float) -> void:
    _health -= amount
    
    # 受伤时短暂锁定武器切换
    weapon_switcher.lock_weapon_type(weapon_switcher.get_current_weapon_type(), 0.5)
    
    if _health <= 0:
        die()

func die() -> void:
    # 死亡时切换到徒手
    weapon_switcher.switch_to_type(WeaponType.Type.NONE)
```

### 武器数据库

```gdscript
# weapon_database.gd (Autoload)
extends Node

@export var weapons: Array[WeaponData]

var _weapon_dict: Dictionary = {}

func _ready() -> void:
    for weapon in weapons:
        _weapon_dict[weapon.id] = weapon

func get_weapon(id: StringName) -> WeaponData:
    return _weapon_dict.get(id)

func has_weapon(id: StringName) -> bool:
    return _weapon_dict.has(id)
```

## 最佳实践

1. **WeaponData作为Resource** - 便于序列化、编辑器编辑
2. **分离Weapon基类** - 具体武器继承实现特有逻辑
3. **切换冷却** - 防止快速切换导致动画混乱
4. **类型锁定** - 特殊状态（眩晕、死亡）锁定武器
5. **输入统一管理** - 输入处理集中在InputHandler
6. **UI解耦** - UI通过信号监听武器系统变化
