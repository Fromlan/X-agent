---
name: godot-skill-upgrade
description: Godot 4 skill tree and upgrade system with JSON config and unlock rules. Use when implementing skill trees, XP levels, talent points, or unlock conditions.
---

# Godot 4 技能与升级系统

完整的技能系统和升级机制，支持JSON配置、技能解锁条件、升级树、经验值系统。

## 何时使用此技能

- 实现玩家技能树
- 角色升级系统
- 技能解锁与前置条件
- 天赋点/技能点系统

## 技能配置格式

### JSON技能配置

```json
{
    "skills": [
        {
            "id": "fireball",
            "name": "火球术",
            "description": "发射一个火球攻击敌人",
            "icon": "res://icons/fireball.png",
            "type": "attack",
            "cost": {
                "mana": 30,
                "cooldown": 2.0
            },
            "unlock": {
                "level_required": 3,
                "skill_required": null,
                "item_required": null
            },
            "upgrade_levels": [
                {
                    "level": 1,
                    "damage": 50,
                    "range": 10.0
                },
                {
                    "level": 2,
                    "damage": 75,
                    "range": 12.0
                },
                {
                    "level": 3,
                    "damage": 100,
                    "range": 15.0
                }
            ]
        },
        {
            "id": "fire_mastery",
            "name": "火焰精通",
            "description": "火焰技能伤害提升15%",
            "icon": "res://icons/fire_mastery.png",
            "type": "passive",
            "cost": {
                "skill_points": 1
            },
            "unlock": {
                "level_required": 5,
                "skill_required": "fireball",
                "item_required": null
            },
            "upgrade_levels": [
                {
                    "level": 1,
                    "damage_bonus": 0.15
                },
                {
                    "level": 2,
                    "damage_bonus": 0.25
                }
            ]
        }
    ]
}
```

### 技能数据结构

```gdscript
# skill_data.gd
class_name SkillData
extends Resource

## 技能唯一标识符
@export var id: StringName

## 技能显示名称
@export var skill_name: String

## 技能描述
@export_multiline var description: String

## 技能图标路径
@export var icon_path: String

## 技能类型
@export_enum("Attack", "Defense", "Support", "Passive", "Ultimate") var skill_type: int = 0

## 消耗
@export var mana_cost: float = 0.0
@export var cooldown: float = 0.0
@export var skill_points_cost: int = 0

## 解锁条件
@export var level_required: int = 1
@export var skill_required: StringName  # 前置技能ID
@export var item_required: StringName   # 所需物品ID

## 升级配置
@export var upgrade_levels: Array[Dictionary] = []

## 最大等级
var max_level: int:
    get: return upgrade_levels.size()

func get_upgrade_data(level: int) -> Dictionary:
    if level <= 0 or level > max_level:
        return {}
    return upgrade_levels[level - 1]

func can_unlock(player_level: int, unlocked_skills: Array, owned_items: Array) -> bool:
    # 检查等级
    if player_level < level_required:
        return false
    
    # 检查前置技能
    if skill_required != null and not skill_required in unlocked_skills:
        return false
    
    return true
```

## 解锁条件判断

### 解锁条件系统

```gdscript
# unlock_condition.gd
class_name UnlockCondition
extends RefCounted

enum ConditionType { LEVEL, SKILL, ITEM, QUEST }

var condition_type: ConditionType
var required_value: Variant

func _init(type: ConditionType, value: Variant) -> void:
    condition_type = type
    required_value = value

static func level_required(level: int) -> UnlockCondition:
    return UnlockCondition.new(ConditionType.LEVEL, level)

static func skill_required(skill_id: StringName) -> UnlockCondition:
    return UnlockCondition.new(ConditionType.SKILL, skill_id)

static func item_required(item_id: StringName) -> UnlockCondition:
    return UnlockCondition.new(ConditionType.ITEM, item_id)

func check(player: Player) -> bool:
    match condition_type:
        ConditionType.LEVEL:
            return player.level >= required_value
        ConditionType.SKILL:
            return player.skills.has(required_value)
        ConditionType.ITEM:
            return player.inventory.has_item(required_value)
    return false
```

### 技能解锁管理器

```gdscript
# skill_unlock_manager.gd
class_name SkillUnlockManager
extends Node

## 可用技能列表
var available_skills: Array[SkillData] = []

## 已解锁技能字典
var unlocked_skills: Dictionary = {}

## 信号：技能解锁
signal skill_unlocked(skill_id: StringName)

## 信号：解锁条件变化
signal unlock_conditions_changed

func _ready() -> void:
    pass

func load_skills_from_json(json_path: String) -> void:
    var file := FileAccess.open(json_path, FileAccess.READ)
    if file == null:
        push_error("无法加载技能配置: ", json_path)
        return
    
    var json_str := file.get_as_text()
    file.close()
    
    var json := JSON.parse_string(json_str)
    if json == null or not json.has("skills"):
        return
    
    for skill_json in json.skills:
        var skill := _create_skill_data(skill_json)
        available_skills.append(skill)

func _create_skill_data(data: Dictionary) -> SkillData:
    var skill := SkillData.new()
    skill.id = data.get("id", "")
    skill.skill_name = data.get("name", "")
    skill.description = data.get("description", "")
    skill.icon_path = data.get("icon", "")
    skill.skill_type = data.get("type", "attack")
    skill.mana_cost = data.get("cost", {}).get("mana", 0)
    skill.cooldown = data.get("cost", {}).get("cooldown", 0)
    skill.skill_points_cost = data.get("cost", {}).get("skill_points", 0)
    skill.level_required = data.get("unlock", {}).get("level_required", 1)
    skill.skill_required = data.get("unlock", {}).get("skill_required")
    skill.item_required = data.get("unlock", {}).get("item_required")
    skill.upgrade_levels = data.get("upgrade_levels", [])
    
    return skill

func try_unlock_skill(skill_id: StringName, player: Player) -> bool:
    var skill := _get_skill_by_id(skill_id)
    if skill == null:
        return false
    
    # 检查是否已解锁
    if unlocked_skills.has(skill_id):
        return false
    
    # 检查解锁条件
    if not skill.can_unlock(player.level, unlocked_skills.keys(), []):
        return false
    
    # 解锁技能
    _unlock_skill(skill_id)
    return true

func _unlock_skill(skill_id: StringName) -> void:
    unlocked_skills[skill_id] = 1  # 等级1
    skill_unlocked.emit(skill_id)

func get_skill_level(skill_id: StringName) -> int:
    return unlocked_skills.get(skill_id, 0)

func can_upgrade_skill(skill_id: StringName) -> bool:
    if not unlocked_skills.has(skill_id):
        return false
    
    var skill := _get_skill_by_id(skill_id)
    if skill == null:
        return false
    
    var current_level := get_skill_level(skill_id)
    return current_level < skill.max_level

func upgrade_skill(skill_id: StringName, player: Player) -> bool:
    if not can_upgrade_skill(skill_id):
        return false
    
    var skill := _get_skill_by_id(skill_id)
    
    # 检查消耗
    if player.skill_points < skill.skill_points_cost:
        return false
    
    # 消耗资源
    player.skill_points -= skill.skill_points_cost
    
    # 升级
    unlocked_skills[skill_id] += 1
    return true

func _get_skill_by_id(skill_id: StringName) -> SkillData:
    for skill in available_skills:
        if skill.id == skill_id:
            return skill
    return null

func get_unlocked_skills() -> Array[SkillData]:
    var result: Array[SkillData] = []
    for skill in available_skills:
        if unlocked_skills.has(skill.id):
            result.append(skill)
    return result

func get_available_skills_for_player(player: Player) -> Array[SkillData]:
    var result: Array[SkillData] = []
    for skill in available_skills:
        if not unlocked_skills.has(skill.id) and skill.can_unlock(player.level, unlocked_skills.keys(), []):
            result.append(skill)
    return result
```

## 升级触发逻辑

### 经验值系统

```gdscript
# experience_system.gd
class_name ExperienceSystem
extends Node

## 信号：升级
signal level_up(new_level: int)

## 信号：经验值变化
signal experience_changed(current: int, required: int)

@export var level_multiplier: float = 1.5
@export var base_exp: int = 100

var current_level: int = 1
var current_exp: int = 0

func _ready() -> void:
    pass

func get_required_exp(level: int) -> int:
    """获取指定等级所需经验值"""
    return int(base_exp * pow(level, level_multiplier))

func add_exp(amount: int) -> bool:
    current_exp += amount
    experience_changed.emit(current_exp, get_required_exp(current_level))
    
    while current_exp >= get_required_exp(current_level):
        current_exp -= get_required_exp(current_level)
        current_level += 1
        level_up.emit(current_level)
    
    return true

func get_exp_progress() -> float:
    var required := get_required_exp(current_level)
    return float(current_exp) / float(required) if required > 0 else 0.0
```

### 技能点系统

```gdscript
# skill_point_system.gd
class_name SkillPointSystem
extends Node

## 信号：技能点变化
signal skill_points_changed(points: int)

@export var base_points_per_level: int = 1
@export var bonus_points_from_quests: int = 0

var total_points: int = 0
var spent_points: int = 0

func _ready() -> void:
    pass

func grant_level_points() -> void:
    total_points += base_points_per_level
    skill_points_changed.emit(get_available_points())

func grant_bonus_points(amount: int) -> void:
    total_points += amount
    skill_points_changed.emit(get_available_points())

func spend_points(amount: int) -> bool:
    if amount > get_available_points():
        return false
    
    spent_points += amount
    skill_points_changed.emit(get_available_points())
    return true

func refund_points(amount: int) -> void:
    spent_points = maxi(spent_points - amount, 0)
    skill_points_changed.emit(get_available_points())

func get_available_points() -> int:
    return total_points - spent_points
```

### 升级触发器

```gdscript
# upgrade_trigger.gd
class_name UpgradeTrigger
extends Node

## 信号：触发升级
signal upgrade_triggered(upgrade_type: StringName, value: Variant)

func _ready() -> void:
    # 连接玩家等级变化
    var exp_system := ExperienceSystem
    exp_system.level_up.connect(_on_level_up)

func _on_level_up(new_level: int) -> void:
    upgrade_triggered.emit("level", new_level)
    
    # 给玩家技能点
    var point_system := SkillPointSystem
    point_system.grant_level_points()
    
    # 检查新技能解锁
    _check_new_skill_unlocks(new_level)

func _check_new_skill_unlocks(player_level: int) -> void:
    var unlock_manager := SkillUnlockManager
    var available := unlock_manager.get_available_skills_for_player(get_parent())
    
    for skill in available:
        if skill.level_required == player_level:
            unlock_manager.try_unlock_skill(skill.id, get_parent())

## 任务完成触发
func trigger_quest_complete(quest_id: StringName) -> void:
    upgrade_triggered.emit("quest", quest_id)

## 物品获得触发
func trigger_item_acquired(item_id: StringName) -> void:
    upgrade_triggered.emit("item", item_id)
```

## UI面板设计

### 技能树面板

```gdscript
# skill_tree_panel.gd
class_name SkillTreePanel
extends Control

@export var skill_unlock_manager: SkillUnlockManager
@export var skill_slot_scene: PackedScene

@onready var scroll_container: ScrollContainer = %ScrollContainer
@onready var skill_grid: GridContainer = %SkillGrid
@onready var skill_points_label: Label = %SkillPointsLabel
@onready var skill_info_panel: PanelContainer = %SkillInfoPanel
@onready var skill_name_label: Label = %SkillNameLabel
@onready var skill_desc_label: Label = %SkillDescLabel
@onready var skill_level_label: Label = %SkillLevelLabel
@onready var upgrade_button: Button = %UpgradeButton

var skill_slotuis: Array[SkillSlotUI] = []
var selected_skill: SkillData = null

func _ready() -> void:
    skill_unlock_manager.skill_unlocked.connect(_on_skill_unlocked)
    skill_unlock_manager.unlock_conditions_changed.connect(_refresh_all)
    
    _create_skill_slots()
    _refresh_all()

func _create_skill_slots() -> void:
    for skill in skill_unlock_manager.available_skills:
        var slot: SkillSlotUI = skill_slot_scene.instantiate()
        slot.skill_data = skill
        slot.clicked.connect(_on_skill_slot_clicked)
        skill_grid.add_child(slot)
        skill_slotuis.append(slot)

func _refresh_all() -> void:
    for slot in skill_slotuis:
        slot.update_display()
    _update_skill_points()

func _on_skill_slot_clicked(skill: SkillData) -> void:
    selected_skill = skill
    _show_skill_info(skill)
    _update_upgrade_button()

func _show_skill_info(skill: SkillData) -> void:
    skill_name_label.text = skill.skill_name
    skill_desc_label.text = skill.description
    
    var current_level := skill_unlock_manager.get_skill_level(skill.id)
    if current_level > 0:
        skill_level_label.text = "等级: %d/%d" % [current_level, skill.max_level]
        
        # 显示当前等级效果
        if current_level > 0 and skill.upgrade_levels.size() >= current_level:
            var upgrade := skill.upgrade_levels[current_level - 1]
            # 显示具体效果...
    else:
        skill_level_label.text = "未解锁"
    
    skill_info_panel.visible = true

func _update_upgrade_button() -> void:
    if selected_skill == null:
        upgrade_button.disabled = true
        return
    
    if skill_unlock_manager.unlocked_skills.has(selected_skill.id):
        if skill_unlock_manager.can_upgrade_skill(selected_skill.id):
            upgrade_button.text = "升级"
            upgrade_button.disabled = false
        else:
            upgrade_button.text = "已满级"
            upgrade_button.disabled = true
    else:
        upgrade_button.text = "解锁"
        upgrade_button.disabled = false

func _on_upgrade_button_pressed() -> void:
    if selected_skill == null:
        return
    
    var player := get_tree().get_first_node_in_group("player")
    if player == null:
        return
    
    if skill_unlock_manager.unlocked_skills.has(selected_skill.id):
        skill_unlock_manager.upgrade_skill(selected_skill.id, player)
    else:
        skill_unlock_manager.try_unlock_skill(selected_skill.id, player)
    
    _refresh_all()
    _show_skill_info(selected_skill)
    _update_upgrade_button()

func _on_skill_unlocked(skill_id: StringName) -> void:
    _refresh_all()

func _update_skill_points() -> void:
    var point_system := SkillPointSystem
    skill_points_label.text = "可用技能点: %d" % point_system.get_available_points()
```

### 技能槽UI

```gdscript
# skill_slot_ui.gd
class_name SkillSlotUI
extends PanelContainer

signal clicked(skill: SkillData)

@export var skill_data: SkillData

@onready var icon_texture: TextureRect = %IconTexture
@onready var lock_icon: TextureRect = %LockIcon
@onready var level_label: Label = %LevelLabel
@onready var name_label: Label = %NameLabel

var is_unlocked: bool = false
var current_level: int = 0

func _ready() -> void:
    mouse_entered.connect(_on_mouse_entered)
    mouse_exited.connect(_on_mouse_exited)
    gui_input.connect(_on_gui_input)

func update_display() -> void:
    if skill_data == null:
        return
    
    var unlock_manager := SkillUnlockManager
    is_unlocked = unlock_manager.unlocked_skills.has(skill_data.id)
    current_level = unlock_manager.get_skill_level(skill_data.id)
    
    # 加载图标
    if skill_data.icon_path != "":
        icon_texture.texture = load(skill_data.icon_path)
    
    # 锁定状态
    lock_icon.visible = not is_unlocked
    
    # 等级显示
    if is_unlocked and current_level > 0:
        level_label.text = "Lv.%d" % current_level
        level_label.visible = true
    else:
        level_label.visible = false
    
    name_label.text = skill_data.skill_name

func _on_gui_input(event: InputEvent) -> void:
    if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
        if event.pressed:
            clicked.emit(skill_data)

func _on_mouse_entered() -> void:
    modulate = Color(1.2, 1.2, 1.2)

func _on_mouse_exited() -> void:
    modulate = Color(1.0, 1.0, 1.0)
```

### 技能信息面板

```gdscript
# skill_info_panel.gd
class_name SkillInfoPanel
extends PanelContainer

@export var name_label: Label
@export var type_label: Label
@export var desc_label: Label
@export var cost_label: Label
@export var effect_label: Label
@export var unlock_condition_label: Label

func show_skill(skill: SkillData, current_level: int) -> void:
    name_label.text = skill.skill_name
    
    var types := ["攻击", "防御", "支援", "被动", "终极"]
    type_label.text = "类型: %s" % types[skill.skill_type]
    
    desc_label.text = skill.description
    
    # 消耗信息
    var cost_text := ""
    if skill.mana_cost > 0:
        cost_text += "魔法消耗: %d\n" % skill.mana_cost
    if skill.cooldown > 0:
        cost_text += "冷却时间: %.1f秒\n" % skill.cooldown
    if skill.skill_points_cost > 0:
        cost_text += "技能点: %d" % skill.skill_points_cost
    cost_label.text = cost_text if cost_text else "无消耗"
    
    # 当前等级效果
    if current_level > 0 and skill.upgrade_levels.size() >= current_level:
        var upgrade := skill.upgrade_levels[current_level - 1]
        var effect_text := ""
        for key in upgrade.keys():
            effect_text += "%s: %s\n" % [key, str(upgrade[key])]
        effect_label.text = effect_text
    else:
        effect_label.text = "效果: 未解锁"
    
    # 解锁条件
    var cond_text := "解锁条件: "
    if skill.level_required > 1:
        cond_text += "等级%d" % skill.level_required
    if skill.skill_required != null:
        cond_text += " | 前置: %s" % skill.skill_required
    unlock_condition_label.text = cond_text
```

## 使用示例

### 玩家角色集成

```gdscript
# player.gd
extends CharacterBody2D

@export var experience_system: ExperienceSystem
@export var skill_point_system: SkillPointSystem
@export var skill_unlock_manager: SkillUnlockManager
@export var buff_component: BuffComponent

var level: int:
    get: return experience_system.current_level

func _ready() -> void:
    skill_unlock_manager.load_skills_from_json("res://data/skills.json")
    
    # 监听升级
    experience_system.level_up.connect(_on_level_up)

func _on_level_up(new_level: int) -> void:
    skill_point_system.grant_level_points()
    
    # 检查自动解锁的技能
    var available := skill_unlock_manager.get_available_skills_for_player(self)
    for skill in available:
        if skill.level_required == new_level:
            skill_unlock_manager.try_unlock_skill(skill.id, self)

func use_skill(skill_id: StringName) -> bool:
    var skill := skill_unlock_manager._get_skill_by_id(skill_id)
    if skill == null:
        return false
    
    var level := skill_unlock_manager.get_skill_level(skill_id)
    if level <= 0:
        return false
    
    # 检查冷却和消耗
    if skill.mana_cost > 0 and _mana < skill.mana_cost:
        return false
    
    if skill.cooldown > 0 and _is_in_cooldown(skill_id):
        return false
    
    # 执行技能效果
    _execute_skill(skill, level)
    return true

func _execute_skill(skill: SkillData, level: int) -> void:
    var upgrade_data := skill.get_upgrade_data(level)
    
    match skill.skill_type:
        0:  # Attack
            _cast_attack_skill(skill.id, upgrade_data)
        1:  # Defense
            _cast_defense_skill(skill.id, upgrade_data)
        2:  # Support
            _cast_support_skill(skill.id, upgrade_data)
        3:  # Passive
            _apply_passive_skill(skill.id, upgrade_data)
        4:  # Ultimate
            _cast_ultimate_skill(skill.id, upgrade_data)

func _cast_attack_skill(skill_id: StringName, data: Dictionary) -> void:
    match skill_id:
        "fireball":
            _cast_fireball(data.get("damage", 50), data.get("range", 10.0))
        "ice_blast":
            _cast_ice_blast(data.get("damage", 30), data.get("slow_duration", 2.0))
```

### 保存与加载

```gdscript
# 保存技能数据
func get_save_data() -> Dictionary:
    return {
        "unlocked_skills": skill_unlock_manager.unlocked_skills,
        "experience": experience_system.current_exp,
        "skill_points_spent": skill_point_system.spent_points
    }

# 加载技能数据
func load_save_data(data: Dictionary) -> void:
    if data.has("unlocked_skills"):
        skill_unlock_manager.unlocked_skills = data.unlocked_skills
    
    if data.has("experience"):
        experience_system.current_exp = data.experience
    
    if data.has("skill_points_spent"):
        skill_point_system.spent_points = data.skill_points_spent
```

## 最佳实践

1. **JSON配置分离** - 技能数据与代码分离，便于策划调整
2. **Resource管理** - SkillData使用Resource便于编辑器编辑
3. **条件检查统一** - 解锁条件集中管理
4. **信号解耦** - UI通过信号监听变化
5. **升级预留** - 支持多级升级配置
6. **点树可视化** - 技能树UI展示前置关系
