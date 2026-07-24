---
name: godot-inventory-system
description: Godot 4 inventory system: data/logic/UI layers, drag-drop, stack capacity. Use when implementing bags, equipment slots, shops, or item management UI.
---

# Godot 4 背包系统

完整的背包系统实现，支持物品添加、移除、拖放排序、格子容量管理等功能。

## 何时使用此技能

- 实现游戏物品管理系统
- 需要拖放交互的背包UI
- 物品类型和数量管理
- 装备栏或商店系统

## 架构设计

### 分层架构

```
背包系统
├── 数据层 (Data Layer)
│   ├── InventoryItem - 单个物品数据
│   └── InventorySlot - 格子数据（包含物品引用和数量）
├── 逻辑层 (Business Layer)
│   └── InventoryComponent - CRUD操作、堆叠逻辑
└── UI层 (Presentation Layer)
    ├── InventoryUI - 背包主面板
    └── InventorySlotUI - 单个格子UI
```

### MVC分离

- **Model**: `InventoryItem`、`InventorySlot` - 纯数据
- **View**: `InventorySlotUI` - 仅负责显示
- **Controller**: `InventoryComponent` - 处理所有业务逻辑

## 数据层设计

### InventoryItem 物品资源

```gdscript
# inventory_item.gd
class_name InventoryItem
extends Resource

## 物品唯一标识符
@export var id: StringName

## 物品显示名称
@export var item_name: String

## 物品描述
@export_multiline var description: String

## 最大堆叠数量
@export var max_stack: int = 99

## 物品图标
@export var icon: Texture2D

## 物品 Prefab（可选，用于拖放到场景）
@export var item_scene: PackedScene

## 物品稀有度
@export_enum("Common", "Uncommon", "Rare", "Epic", "Legendary") var rarity: int = 0

## 是否可以丢弃
@export var can_drop: bool = true

## 是否可以堆叠
@export var can_stack: bool = true

## 物品价值（用于商店）
@export var value: int = 1
```

### InventorySlot 格子数据

```gdscript
# inventory_slot.gd
class_name InventorySlot
extends RefCounted

## 格子索引
var index: int

## 格子中的物品
var item: InventoryItem

## 物品数量
var quantity: int = 0

## 格子是否为空
var is_empty: bool:
    get: return item == null or quantity <= 0

func can_add(new_item: InventoryItem, amount: int = 1) -> bool:
    if is_empty:
        return true
    if item.id == new_item.id and item.can_stack:
        return quantity + amount <= item.max_stack
    return false

func add(new_item: InventoryItem, amount: int = 1) -> bool:
    if not can_add(new_item, amount):
        return false
    
    if is_empty:
        item = new_item
        quantity = amount
    else:
        quantity += amount
    
    return true

func remove(amount: int = 1) -> bool:
    if is_empty or quantity < amount:
        return false
    
    quantity -= amount
    if quantity <= 0:
        clear()
    return true

func clear() -> void:
    item = null
    quantity = 0
```

## 逻辑层设计

### InventoryComponent 背包组件

```gdscript
# inventory_component.gd
class_name InventoryComponent
extends Node

## 背包容量
@export var capacity: int = 20

## 信号：物品添加成功
signal item_added(slot_index: int, item: InventoryItem, quantity: int)

## 信号：物品移除成功
signal item_removed(slot_index: int, item: InventoryItem, quantity: int)

## 信号：背包满了
signal inventory_full(item: InventoryItem)

## 信号：格子数据变化
signal slot_changed(slot_index: int)

## 背包格子数组
var slots: Array[InventorySlot] = []

func _ready() -> void:
    _initialize_slots()

func _initialize_slots() -> void:
    for i in capacity:
        var slot := InventorySlot.new()
        slot.index = i
        slots.append(slot)

## 添加物品到背包
func add_item(item: InventoryItem, quantity: int = 1) -> bool:
    # 优先堆叠到已有物品
    var target_slot := _find_stackable_slot(item)
    if target_slot != null:
        var old_qty := target_slot.quantity
        target_slot.add(item, quantity)
        slot_changed.emit(target_slot.index)
        item_added.emit(target_slot.index, item, target_slot.quantity - old_qty)
        return true
    
    # 找空格子
    var empty_slot := _find_empty_slot()
    if empty_slot != null:
        empty_slot.add(item, quantity)
        slot_changed.emit(empty_slot.index)
        item_added.emit(empty_slot.index, item, quantity)
        return true
    
    # 背包满了
    inventory_full.emit(item)
    return false

## 移除物品
func remove_item(slot_index: int, quantity: int = 1) -> bool:
    if slot_index < 0 or slot_index >= slots.size():
        return false
    
    var slot: InventorySlot = slots[slot_index]
    if slot.is_empty:
        return false
    
    var item := slot.item
    if slot.remove(quantity):
        slot_changed.emit(slot_index)
        item_removed.emit(slot_index, item, quantity)
        return true
    
    return false

## 交换两个格子的物品
func swap_slots(index1: int, index2: int) -> void:
    if index1 < 0 or index1 >= slots.size() or index2 < 0 or index2 >= slots.size():
        return
    
    var temp_item := slots[index1].item
    var temp_qty := slots[index1].quantity
    
    slots[index1].item = slots[index2].item
    slots[index1].quantity = slots[index2].quantity
    
    slots[index2].item = temp_item
    slots[index2].quantity = temp_qty
    
    slot_changed.emit(index1)
    slot_changed.emit(index2)

## 移动物品到另一个背包
func move_to(target: InventoryComponent, slot_index: int, quantity: int = -1) -> bool:
    if slot_index < 0 or slot_index >= slots.size():
        return false
    
    var slot: InventorySlot = slots[slot_index]
    if slot.is_empty:
        return false
    
    var transfer_qty := quantity if quantity > 0 else slot.quantity
    
    if target.add_item(slot.item, transfer_qty):
        remove_item(slot_index, transfer_qty)
        return true
    
    return false

## 查找可堆叠的格子
func _find_stackable_slot(item: InventoryItem) -> InventorySlot:
    if not item.can_stack:
        return null
    
    for slot in slots:
        if not slot.is_empty and slot.item.id == item.id:
            if slot.quantity + 1 <= slot.item.max_stack:
                return slot
    
    return null

## 查找空格子
func _find_empty_slot() -> InventorySlot:
    for slot in slots:
        if slot.is_empty:
            return slot
    return null

## 获取指定物品的数量
func get_item_count(item_id: StringName) -> int:
    var total := 0
    for slot in slots:
        if not slot.is_empty and slot.item.id == item_id:
            total += slot.quantity
    return total

## 清空背包
func clear() -> void:
    for slot in slots:
        slot.clear()
        slot_changed.emit(slot.index)

## 保存背包数据
func get_save_data() -> Dictionary:
    var data := []
    for slot in slots:
        if not slot.is_empty:
            data.append({
                "index": slot.index,
                "item_id": slot.item.id,
                "quantity": slot.quantity
            })
    return {"slots": data, "capacity": capacity}

## 加载背包数据
func load_save_data(data: Dictionary) -> void:
    clear()
    if data.has("slots"):
        for slot_data in data.slots:
            var index: int = slot_data.index
            var item_id: StringName = slot_data.item_id
            var quantity: int = slot_data.quantity
            
            # 查找物品数据（实际项目中从物品数据库获取）
            var item := _get_item_by_id(item_id)
            if item != null and index < slots.size():
                slots[index].item = item
                slots[index].quantity = quantity
                slot_changed.emit(index)
```

## UI系统设计

### InventorySlotUI 格子UI

```gdscript
# inventory_slot_ui.gd
class_name InventorySlotUI
extends PanelContainer

## 信号：物品被拖走
signal item_drag_started(slot_index: int)

## 信号：物品放置到格子
signal item_dropped(slot_index: int, from_slot: int)

## 信号：右键点击
signal right_clicked(slot_index: int)

@export var slot_index: int = 0

@onready var icon_texture: TextureRect = %IconTexture
@onready var quantity_label: Label = %QuantityLabel
@onready var item_name_label: Label = %ItemNameLabel

var current_item: InventoryItem
var current_quantity: int = 0
var _is_dragging: bool = false

func _ready() -> void:
    mouse_filter = Control.MOUSE_FILTER_STOP
    
    # 初始化为空白
    _clear_display()

func set_slot_data(slot: InventorySlot) -> void:
    if slot.is_empty:
        _clear_display()
        return
    
    current_item = slot.item
    current_quantity = slot.quantity
    
    _update_display()

func _update_display() -> void:
    if current_item == null:
        _clear_display()
        return
    
    icon_texture.texture = current_item.icon
    icon_texture.visible = true
    
    if current_quantity > 1:
        quantity_label.text = str(current_quantity)
        quantity_label.visible = true
    else:
        quantity_label.visible = false
    
    item_name_label.text = current_item.item_name
    item_name_label.visible = true

func _clear_display() -> void:
    current_item = null
    current_quantity = 0
    icon_texture.texture = null
    icon_texture.visible = false
    quantity_label.visible = false
    item_name_label.visible = false

func _on_mouse_entered() -> void:
    if current_item != null:
        # 显示物品提示
        pass

func _on_gui_input(event: InputEvent) -> void:
    if event is InputEventMouseButton:
        if event.button_index == MOUSE_BUTTON_LEFT:
            if event.pressed:
                _on_left_click()
            else:
                _on_left_release()
        elif event.button_index == MOUSE_BUTTON_RIGHT and event.pressed:
            right_clicked.emit(slot_index)

func _on_left_click() -> void:
    if current_item != null:
        item_drag_started.emit(slot_index)

func _on_left_release() -> void:
    pass
```

### InventoryUI 背包主面板

```gdscript
# inventory_ui.gd
class_name InventoryUI
extends Control

@export var inventory_component: InventoryComponent
@export var slot_scene: PackedScene

@onready var grid_container: GridContainer = %GridContainer
@onready var title_label: Label = %TitleLabel

var slotuis: Array[InventorySlotUI] = []
var _dragged_slot_index: int = -1
var _drag_preview: Control

func _ready() -> void:
    assert(inventory_component != null, "InventoryComponent未设置")
    
    inventory_component.slot_changed.connect(_on_slot_changed)
    inventory_component.inventory_full.connect(_on_inventory_full)
    
    _create_slot_ui()
    _refresh_all_slots()

func _create_slot_ui() -> void:
    for i in inventory_component.capacity:
        var slot_ui: InventorySlotUI = slot_scene.instantiate()
        slot_ui.slot_index = i
        slot_ui.item_drag_started.connect(_on_item_drag_started)
        slot_ui.item_dropped.connect(_on_item_dropped)
        slot_ui.right_clicked.connect(_on_slot_right_clicked)
        grid_container.add_child(slot_ui)
        slotuis.append(slot_ui)

func _refresh_all_slots() -> void:
    for i in inventory_component.slots.size():
        slotuis[i].set_slot_data(inventory_component.slots[i])

func _on_slot_changed(slot_index: int) -> void:
    if slot_index < slotuis.size():
        slotuis[slot_index].set_slot_data(inventory_component.slots[slot_index])

func _on_inventory_full(item: InventoryItem) -> void:
    # 显示提示（例如："背包已满"）
    print("背包已满，无法添加 ", item.item_name)

func _on_item_drag_started(slot_index: int) -> void:
    _dragged_slot_index = slot_index

func _on_item_dropped(slot_index: int, from_slot: int) -> void:
    if from_slot != slot_index:
        inventory_component.swap_slots(from_slot, slot_index)

func _on_slot_right_clicked(slot_index: int) -> void:
    var slot: InventorySlot = inventory_component.slots[slot_index]
    if slot.is_empty:
        return
    
    # 丢弃物品或显示物品菜单
    if slot.item.can_drop:
        inventory_component.remove_item(slot_index, 1)

func _input(event: InputEvent) -> void:
    if event.is_action_pressed("toggle_inventory"):
        visible = not visible
        if visible:
            _refresh_all_slots()
```

## 使用示例

### 物品数据库

```gdscript
# item_database.gd (Autoload)
extends Node

@export var items: Array[InventoryItem]

func _ready() -> void:
    # 注册所有物品到全局数据库
    pass

func get_item(id: StringName) -> InventoryItem:
    for item in items:
        if item.id == id:
            return item
    return null

func has_item(id: StringName) -> bool:
    return get_item(id) != null
```

### 玩家装备背包

```gdscript
# player.gd
extends CharacterBody2D

@export var inventory: InventoryComponent

func _ready() -> void:
    # 给玩家一些初始物品
    var sword := item_database.get_item("sword")
    var potion := item_database.get_item("health_potion")
    
    if sword:
        inventory.add_item(sword, 1)
    if potion:
        inventory.add_item(potion, 5)
```

## 最佳实践

1. **数据与显示分离** - InventorySlot只存储数据，不负责显示
2. **使用Resource** - InventoryItem作为Resource便于序列化
3. **信号解耦** - UI通过信号监听数据变化，不直接查询数据
4. **堆叠逻辑** - 添加物品时优先堆叠，节省格子空间
5. **保存/加载** - 使用get_save_data()和load_save_data()实现持久化

## 扩展功能

- **物品类型过滤** - 不同背包类型接受不同物品
- **商人系统** - 买卖物品基于value
- **装备栏** - 特殊格子只能放特定类型装备
- **合成系统** - 物品组合生成新物品
