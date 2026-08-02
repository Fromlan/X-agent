# Godot TileSet 结构格式调研与前端配置工具设计

> 调研 Godot 4 `.tres` 格式中 TileSet、TileSetAtlasSource、TileData 的完整数据结构，分析 UID 生成机制、PackedVector2Array 等关键数据的存储格式，并设计基于 Electron + Canvas 的前端 Tileset 配置工具方案。

---

## 一、TileSet 资源总览

### 1.1 继承链

```
TileSet → Resource → RefCounted → Object
  ├── 包含多个 TileSetSource（通过 sources/N 索引）
  │     └── TileSetAtlasSource → TileSetSource → Resource
  │           └── 为每个图块坐标提供 TileData
  │                 └── TileData → Object（非 Resource,不独立存储）
  └── 定义全局：tile_size, tile_shape, layers, terrains, patterns
```

### 1.2 关键概念

| 概念 | 说明 |
|------|------|
| **Source（源）** | 图块集合容器，通过 `sources/0`, `sources/1` 等整数 ID 索引 |
| **Atlas Coords（图集坐标）** | 纹理上的网格坐标 `(x, y)`，以 `texture_region_size` 为单位 |
| **Alternative Tile（备选图块）** | 同一坐标下的不同配置变体，ID=0 为主图块，ID≥1 为备选 |
| **TileData** | 存储当图块放置在 TileMap 上时的所有属性（碰撞、导航、自定义数据等） |

---

## 二、.tres 文件格式深度分析

### 2.1 全局结构

Godot 4 `.tres` 使用 `format=3`，是 INI 风格的文本格式，分为四个逻辑段：

```ini
; ① 文件头 — 全局资源声明
[gd_resource type="TileSet" format=3 uid="uid://cs1yi60wn8mtp"]

; ② 外部资源引用 — ext_resource 映射 Godot 资源路径
[ext_resource type="Texture2D" uid="uid://qj1jww0yjb36" path="res://Room_Builder_48x48.png" id="1_d6eug"]

; ③ 子资源定义 — sub_resource 内联存储 TileSetAtlasSource
[sub_resource type="TileSetAtlasSource" id="TileSetAtlasSource_ej02t"]
texture = ExtResource("1_d6eug")
texture_region_size = Vector2i(48, 48)
; ... 图块条目 ...

; ④ 主资源数据 — 根 TileSet 的属性与子资源绑定
[resource]
tile_size = Vector2i(48, 48)
sources/1 = SubResource("TileSetAtlasSource_ej02t")
```

### 2.2 段头语法详解

#### 2.2.1 `[gd_resource]` — 文件头（必有，仅一行）

```ini
[gd_resource type="TileSet" format=3 uid="uid://cs1yi60wn8mtp"]
```

| 字段 | 说明 |
|------|------|
| `type` | 资源类型（`TileSet`, `PackedScene`, `Material` 等） |
| `format` | 序列化格式版本（Godot 4 为 `3`） |
| `uid` | `uid://` 前缀 + base35 编码的 63-bit 整数（见第五章） |

#### 2.2.2 `[ext_resource]` — 外部资源引用

```ini
[ext_resource type="Texture2D" uid="uid://qj1jww0yjb36" path="res://Room_Builder_48x48.png" id="1_d6eug"]
```

| 字段 | 说明 |
|------|------|
| `type` | 外部资源类型 |
| `uid` | 该资源在 `.godot/uid_cache` 中注册的 UID |
| `path` | `res://` 开头的项目相对路径 |
| `id` | 格式 `数字_随机串`（如 `1_d6eug`），在同一 .tres 内用于 `ExtResource("1_d6eug")` 引用 |

> **关键**：`id` 由 Godot 编辑器自动生成，`_` 后为随机字符串，确保跨文件引用唯一性。前端工具生成的 `.tres` 中，需保证 id 不与其他 ext_resource 冲突。

#### 2.2.3 `[sub_resource]` — 内联子资源

```ini
[sub_resource type="TileSetAtlasSource" id="TileSetAtlasSource_ej02t"]
```

| 字段 | 说明 |
|------|------|
| `type` | 子资源类型 |
| `id` | 同一 .tres 文件内的唯一标识，格式 `TypeName_随机串` |

子资源的所有属性直接写在 `[sub_resource]` 段内，每个属性一行。

#### 2.2.4 `[resource]` — 主资源属性

```ini
[resource]
tile_size = Vector2i(48, 48)
sources/0 = SubResource("TileSetAtlasSource_ej02t")
```

根 TileSet 的全局属性和子资源绑定写在此段。

### 2.3 值的序列化格式

| Godot 类型 | .tres 文本格式 | 示例 |
|-----------|---------------|------|
| `bool` | `true` / `false` | `true` |
| `int` | 十进制数字 | `0`, `-1`, `48` |
| `float` | 小数 | `1.0`, `0.5` |
| `String` | 双引号包裹 | `"hello"` |
| `Vector2i` | `Vector2i(x, y)` | `Vector2i(48, 48)` |
| `Vector2` | `Vector2(x, y)` | `Vector2(0.5, 0.5)` |
| `Color` | `Color(r, g, b, a)` | `Color(1, 1, 1, 1)` |
| `Rect2i` | `Rect2i(x, y, w, h)` | `Rect2i(0, 0, 48, 48)` |
| **`PackedVector2Array`** | `PackedVector2Array(x1, y1, x2, y2, ...)` | 见 2.4 节 |
| 资源引用（外部） | `ExtResource("id")` | `ExtResource("1_d6eug")` |
| 资源引用（内联） | `SubResource("id")` | `SubResource("TileSetAtlasSource_ej02t")` |
| `null` 资源 | `null` | `null` |

### 2.4 PackedVector2Array 序列化（重点）

```
PackedVector2Array(x1, y1, x2, y2, x3, y3, x4, y4)
```

**规则：**
- 所有坐标平铺在一行，无括号分隔
- 顺序为 `(x₁, y₁, x₂, y₂, x₃, y₃, ...)` — 每两个连续数字构成一个 `Vector2`
- 元素数量 = 数字总数 / 2
- 如 4 个顶点的矩形：`PackedVector2Array(-8, -8, 8, -8, 8, 8, -8, 8)`

**实际案例（碰撞多边形）：**
```ini
2:0/0/physics_layer_0/polygon_0/points = PackedVector2Array(-8, -8, 8, -8, 8, 8, -8, 8)
```

> **解析方法**：匹配 `PackedVector2Array\((.*?)\)` 正则，提取逗号分隔的数字列表，每 2 个数字组成一个 `{x, y}` 点。

### 2.5 嵌套属性路径语法

`.tres` 文件用 `/` 分隔的扁平路径表示嵌套结构：

```
atlas_coords / alternative_id / property_path = value
```

**路径段规则：**

| 路径模式 | 含义 | 示例 |
|---------|------|------|
| `x:y` | 图集网格坐标（必填，冒号分隔） | `52:106` — 网格列52、行106 |
| `/0` | 主图块（alternative_id=0） | `52:106/0 = 0` |
| `/1`, `/2` | 备选图块（alternative_id≥1） | `9:0/1 = 1` |
| `/property` | TileData 的直接属性 | `6:13/0/texture_origin = Vector2i(-24, 0)` |
| `/layer_N/polygon_N/...` | 物理/导航/遮挡层嵌套 | `2:0/0/physics_layer_0/polygon_0/points = ...` |

**完整案例：**
```ini
# TileData 基础属性
9:0/next_alternative_id = 2         ; 下一个备选 ID 计数器
9:0/0 = 0                            ; 主图块存在标记（值=0）
9:0/1 = 1                            ; 备选图块 1（值=概率权重）
9:0/0/texture_origin = Vector2i(0, 0)
9:0/0/probability = 1.0
9:0/0/z_index = 0
9:0/0/flip_h = false
9:0/0/flip_v = false
9:0/0/modulate = Color(1, 1, 1, 1)
9:0/0/terrain_set = -1
9:0/0/terrain = -1

# 尺寸（非 1×1 图块）
0:13/size_in_atlas = Vector2i(3, 3)

# 碰撞多边形
2:0/0/physics_layer_0/polygon_0/points = PackedVector2Array(-8, -8, 8, -8, 8, 8, -8, 8)
```

### 2.6 图块条目格式总结

```
格式:  <col>:<row>/<alternative_id>[/<property_path>] = <value>

col:row            图集网格坐标，基于 texture_region_size
alternative_id     0=主图块, 1,2,...=备选图块
property_path      可选。省略时 value 为 0（标记图块存在）或概率权重
value              根据属性类型不同: int, float, bool, Vector2i(...), PackedVector2Array(...), Color(...)
```

---

## 三、TileSetAtlasSource 数据结构

### 3.1 核心属性

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `texture` | `ExtResource(...)` | **必填** | 图集纹理引用 |
| `texture_region_size` | `Vector2i` | `(16,16)` | 每个图块的基础像素大小 |
| `margins` | `Vector2i` | `(0,0)` | 纹理四周边距 |
| `separation` | `Vector2i` | `(0,0)` | 图块间距 |
| `use_texture_padding` | `bool` | `true` | 是否使用纹理填充避免边缘采样 |

### 3.2 图块属性（以坐标路径存储）

#### 图块基础

| 路径 | 类型 | 说明 |
|------|------|------|
| `x:y/size_in_atlas` | `Vector2i` | 图块占用的网格数，如 `(3,3)` 表示 3×3 |
| `x:y/next_alternative_id` | `int` | 该坐标的下一个备选 ID 计数器 |
| `x:y/0` | `int` (=0) | 主图块存在标记 |
| `x:y/N` | `int` (=1 或概率权重) | 备选图块 N |

#### TileData 属性（per alternative）

| 路径（相对于 `x:y/N/`） | 类型 | 默认 | 说明 |
|--------------------------|------|------|------|
| `flip_h` | `bool` | `false` | 水平翻转 |
| `flip_v` | `bool` | `false` | 垂直翻转 |
| `transpose` | `bool` | `false` | 转置（90°旋转 + 翻转） |
| `texture_origin` | `Vector2i` | `(0,0)` | 纹理偏移 |
| `probability` | `float` | `1.0` | 随机放置权重 |
| `z_index` | `int` | `0` | 渲染层级 |
| `y_sort_origin` | `int` | `0` | Y 排序原点 |
| `modulate` | `Color` | `(1,1,1,1)` | 颜色调制 |
| `material` | `Material` | `null` | 材质覆盖 |
| `terrain_set` | `int` | `-1` | 所属地形集 |
| `terrain` | `int` | `-1` | 地形 ID |
| `physics_layer_N/...` | — | — | 物理碰撞（见 4.3） |
| `navigation_layer_N/...` | — | — | 导航区域（见 4.3） |
| `occlusion_layer_N/...` | — | — | 光照遮挡（见 4.3） |

#### 动画属性

| 路径（相对于 `x:y/`） | 类型 | 说明 |
|------------------------|------|------|
| `animation_columns` | `int` | 动画帧列数 |
| `animation_separation` | `Vector2i` | 动画帧间距 |
| `animation_speed` | `float` | 动画速度 |
| `animation_frames_count` | `int` | 动画帧数 |
| `animation_mode` | `int` | 0=默认, 1=随机起始帧 |
| `animation_frame_duration/N` | `float` | 第 N 帧持续时间 |

---

## 四、TileData 数据结构

### 4.1 核心属性

```typescript
interface TileDataProperties {
  // 渲染
  flip_h: boolean;           // 水平翻转
  flip_v: boolean;           // 垂直翻转
  transpose: boolean;        // 转置
  texture_origin: {x: number, y: number};  // 纹理原点偏移
  modulate: {r: number, g: number, b: number, a: number};
  material: string | null;   // 材质资源路径
  z_index: number;           // 渲染层级
  y_sort_origin: number;     // Y 排序原点

  // 随机
  probability: number;       // 放置权重 (0.0 ~ 1.0)

  // 地形
  terrain_set: number;       // -1 = 无
  terrain: number;           // -1 = 无
  terrain_peering_bits: Record<number, number>;  // 16 方向地形匹配位

  // 物理层（多层，每层可有多个多边形）
  physics_layers: PhysicsLayer[];

  // 导航层
  navigation_layers: NavigationLayer[];

  // 遮挡层
  occlusion_layers: OcclusionLayer[];

  // 自定义数据层（TileSet 级别定义，TileData 级别赋值）
  custom_data: Record<string, any>;  // key = 层名, value = 类型值
}
```

### 4.2 备选图块 (Alternative Tile) 机制

```
坐标 (9, 0) 有一个 1×3 的图块:
  9:0/size_in_atlas = Vector2i(1, 3)    ; 占用 1 列 × 3 行
  9:0/next_alternative_id = 2            ; 下一个备选 ID = 2（0和1已被使用）
  9:0/0 = 0                              ; 主图块（概率 = 0 即默认）
  9:0/1 = 1                              ; 备选图块 1（概率权重 = 1）
```

**备选图块的作用：**
- 同一纹理坐标下可有多个不同配置（不同碰撞、不同概率、不同翻转）
- TileMap 放置时按概率随机选择备选
- `next_alternative_id` 追踪该坐标下一个可用的备选 ID

### 4.3 物理 / 导航 / 遮挡层结构

#### 物理层（Physics Layer）

```ini
; .tres 中的存储格式
x:y/0/physics_layer_0/polygon_0/points = PackedVector2Array(-8, -8, 8, -8, 8, 8, -8, 8)
x:y/0/physics_layer_0/polygon_0/one_way = false
x:y/0/physics_layer_0/polygon_0/one_way_margin = 1.0
```

物理多边形坐标以 **图块本地坐标系** 表示，原点在图块中心，范围通常为 `(-tile_size/2, -tile_size/2)` 到 `(tile_size/2, tile_size/2)`。

```typescript
interface PhysicsLayer {
  collision_layer: number;     // 位掩码
  collision_mask: number;      // 位掩码
  collision_priority: number;
  physics_material: string | null;
  polygons: PhysicsPolygon[];
}

interface PhysicsPolygon {
  points: Array<{x: number, y: number}>;
  one_way: boolean;
  one_way_margin: number;
}
```

#### 导航层与遮挡层

导航层以 `NavigationPolygon` 子资源存储（更复杂，通常不直接在内联属性中展开），遮挡层以 `OccluderPolygon2D` 存储。

### 4.4 TileSet 全局属性

```ini
[resource]
tile_size = Vector2i(48, 48)
tile_shape = 0              ; 0=Square, 1=Isometric, 2=HalfOffset, 3=Hexagon
tile_layout = 0
uv_clipping = false

; 自定义数据层声明
custom_data_layer_0/name = "is_walkable"
custom_data_layer_0/type = 1    ; Variant.Type: 1=bool, 2=int, 3=float, 4=String

; 物理层全局设置
physics_layer_0/collision_layer = 1
physics_layer_0/collision_mask = 1
physics_layer_0/physics_material = null

; 地形集
terrain_set_0/mode = 0
terrain_set_0/terrain_0/name = "grass"
terrain_set_0/terrain_0/color = Color(0.2, 0.8, 0.2, 1)

; 子资源绑定
sources/0 = SubResource("TileSetAtlasSource_ej02t")
sources/1 = SubResource("TileSetAtlasSource_35rcx")
```

---

## 五、Godot UID 生成机制

### 5.1 内部表示

- UID 内部为 **63-bit 正整数**（`0` ~ `0x7FFFFFFFFFFFFFFF`）
- `-1` = `INVALID_ID`，文本表示为 `uid://<invalid>`
- 由 `ResourceUID::create_id()` 生成（基于随机数生成器）

### 5.2 编码算法

Godot 使用**自定义 Base-35 编码**（不是标准 Base64）。文本表示：`uid://` + 最多 13 个字符。

**字符表（35 个）：**
```
a b c d e f g h i j k l m n o p q r s t u v w x y
0 1 2 3 4 5 6 7 8
```

注意：**`z` 和 `9` 不在字符表中**（这是已知 bug：GH-83843）。

### 5.3 编码伪代码

```python
# Integer → UID String
def id_to_text(uid):
    if uid < 0: return "uid://<invalid>"
    chars = "abcdefghijklmnopqrstuvwxy012345678"
    tmp = []
    while True:
        c = uid % 35
        tmp.append(chars[c])
        uid //= 35
        if uid == 0: break
    return "uid://" + "".join(reversed(tmp))

# UID String → Integer
def text_to_id(text):
    if not text.startswith("uid://") or text == "uid://<invalid>":
        return -1
    chars = "abcdefghijklmnopqrstuvwxy012345678"
    uid = 0
    for ch in text[6:]:         # skip "uid://"
        uid *= 34               # note: 解码用 34 不是 35（bug）
        if 'a' <= ch <= 'y':
            uid += ord(ch) - ord('a')
        elif '0' <= ch <= '8':
            uid += ord(ch) - ord('0') + 25
        else:
            return -1
    return uid & 0x7FFFFFFFFFFFFFFF
```

### 5.4 JavaScript 实现

```typescript
const UID_ALPHABET = 'abcdefghijklmnopqrstuvwxy012345678';

/** 将 63-bit 整数编码为 Godot uid:// 字符串 */
function idToText(id: bigint): string {
  if (id < 0n) return 'uid://<invalid>';
  const tmp: string[] = [];
  let v = id;
  do {
    const idx = Number(v % 35n);
    tmp.push(UID_ALPHABET[idx]);
    v = v / 35n;
  } while (v > 0n);
  return 'uid://' + tmp.reverse().join('');
}

/** 将 Godot uid:// 字符串解码为整数 */
function textToId(text: string): bigint {
  if (!text.startsWith('uid://') || text === 'uid://<invalid>') {
    return -1n;
  }
  let uid = 0n;
  for (let i = 6; i < text.length; i++) {
    uid *= 34n;  // 注意：解码用 34
    const ch = text[i];
    if (ch >= 'a' && ch <= 'y') {
      uid += BigInt(ch.charCodeAt(0) - 'a'.charCodeAt(0));
    } else if (ch >= '0' && ch <= '8') {
      uid += BigInt(ch.charCodeAt(0) - '0'.charCodeAt(0) + 25);
    } else {
      return -1n;
    }
  }
  const MASK = (1n << 63n) - 1n;
  return uid & MASK;
}

/** 生成新的 Godot UID（随机 63-bit） */
function generateUid(): string {
  const id = BigInt.asUintN(63,
    (BigInt(Math.floor(Math.random() * 0x100000000)) << 31n) |
    BigInt(Math.floor(Math.random() * 0x7FFFFFFF))
  );
  return idToText(id);
}

/** 生成 ext_resource 的 id 字段（格式: "1_xxxxx"） */
function generateExtResourceId(index: number): string {
  const randomPart = Math.random().toString(36).substring(2, 7);
  return `${index}_${randomPart}`;
}

/** 生成 sub_resource 的 id 字段（格式: "TypeName_xxxxx"） */
function generateSubResourceId(typeName: string): string {
  const randomPart = Math.random().toString(36).substring(2, 7);
  return `${typeName}_${randomPart}`;
}
```

### 5.5 前端工具生成策略

| 场景 | 策略 |
|------|------|
| **编辑已有 .tres** | 保持原 `uid` 不变；新增 ext_resource 的 id 需保证不与已有冲突 |
| **新建 TileSet** | 调用 `generateUid()` 生成新的主 UID |
| **新增外部纹理** | 生成新的 `ext_resource id`，同时为新纹理生成 UID |
| **新增子资源** | 生成新的 `sub_resource id` |

---

## 六、前端配置工具方案设计

### 6.1 核心功能

```
┌──────────────────────────────────────────────────────────┐
│  Godot Tileset 配置工具                                   │
│                                                          │
│  ┌─────────────┐  ┌──────────────────────────────────┐   │
│  │ 文件树       │  │  Canvas 预览区                    │   │
│  │             │  │  ┌────────────────────────────┐  │   │
│  │ 项目目录     │  │  │                            │  │   │
│  │  ├ textures/ │  │  │  纹理 + 网格线 + 高亮       │  │   │
│  │  ├ tilesets/ │  │  │  点击选择图块 → 右侧属性     │  │   │
│  │  └ scenes/   │  │  │                            │  │   │
│  │             │  │  └────────────────────────────┘  │   │
│  │             │  │                                   │   │
│  └─────────────┘  └──────────────────────────────────┘   │
│                                                          │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  属性编辑面板                                        │  │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌───────────┐ │  │
│  │  │ 基础属性 │ │ 物理碰撞 │ │ 导航区  │ │ 自定义数据 │ │  │
│  │  │ 纹理原点 │ │ 多边形编辑│ │ 导航网格│ │ 层值编辑  │ │  │
│  │  │ 概率/层级│ │ 单向平台 │ │         │ │           │ │  │
│  │  │ 翻转/转置│ │         │ │         │ │           │ │  │
│  │  └─────────┘ └─────────┘ └─────────┘ └───────────┘ │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                          │
│  [保存到 .tres]  [另存为...]  [撤销]  [重做]              │
└──────────────────────────────────────────────────────────┘
```

### 6.2 技术架构

```
┌─────────────────────────────────────────────────────────┐
│  Electron Main Process                                  │
│                                                         │
│  ┌───────────────┐  ┌─────────────────────────────────┐ │
│  │ main.ts       │  │ TilesetEditorManager            │ │
│  │ 已有窗口管理   │  │ - openEditor(projectPath, file) │ │
│  └───────────────┘  │ - readTileset(path)             │ │
│                     │ - writeTileset(path, data)      │ │
│                     │ - readTexture(path) → base64    │ │
│                     │ - listProjectFiles(dir)         │ │
│                     └─────────────────────────────────┘ │
│                              │                          │
│                     IPC (invoke/handle)                 │
│                              │                          │
├──────────────────────────────┼──────────────────────────┤
│  Electron Renderer (Tileset Editor Window)              │
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │  React App (独立入口 html → tileset-editor.tsx)   │  │
│  │                                                   │  │
│  │  ┌──────────┐  ┌───────────────┐  ┌──────────┐  │  │
│  │  │ FileTree │  │ CanvasEditor  │  │ PropPanel│  │  │
│  │  │ 组件     │  │ 组件          │  │ 组件     │  │  │
│  │  └──────────┘  └───────────────┘  └──────────┘  │  │
│  │                      │                           │  │
│  │               Canvas 操作层                       │  │
│  │           ├── 纹理渲染 (drawImage)                │  │
│  │           ├── 网格线 (strokeRect)                 │  │
│  │           ├── 图块标记 (fillStyle + 半透明覆盖)    │  │
│  │           ├── 选中高亮 (蓝色边框)                  │  │
│  │           └── 碰撞多边形编辑 (可拖拽顶点)          │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### 6.3 Electron 新窗口实现

在 X-agent 现有 `main.ts` 中添加 tileset 编辑器窗口支持：

```typescript
// electron/main.ts 新增部分

let tilesetEditorWindow: BrowserWindow | null = null;

// 注册 IPC handler
ipcMain.handle('openTilesetEditor', async (_e, options: {
  projectPath: string;
  tilesetPath?: string;  // 可选：打开已有 tileset
}) => {
  if (tilesetEditorWindow && !tilesetEditorWindow.isDestroyed()) {
    tilesetEditorWindow.focus();
    return { ok: true };
  }

  tilesetEditorWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    title: 'Tileset 编辑器',
    backgroundColor: '#141414',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // ★ 传递初始化数据
      additionalArguments: [
        `--tileset-editor-mode`,
        `--project-path=${options.projectPath}`,
        ...(options.tilesetPath ? [`--tileset-path=${options.tilesetPath}`] : []),
      ],
    },
  });

  // 加载独立的编辑器页面
  if (process.env.ELECTRON_RENDERER_URL) {
    tilesetEditorWindow.loadURL(
      `${process.env.ELECTRON_RENDERER_URL}#/tileset-editor`
    );
  } else {
    tilesetEditorWindow.loadFile(
      join(__dirname, '../renderer/index.html'),
      { hash: '/tileset-editor' }
    );
  }

  tilesetEditorWindow.on('closed', () => {
    tilesetEditorWindow = null;
  });

  return { ok: true };
});

// Tileset 数据读取
ipcMain.handle('readTileset', async (_e, filePath: string) => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return { ok: true, content };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

// Tileset 数据写入
ipcMain.handle('writeTileset', async (_e, filePath: string, content: string) => {
  try {
    fs.writeFileSync(filePath, content, 'utf-8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

// 纹理文件读取（转为 base64 供 Canvas 渲染）
ipcMain.handle('readTextureBase64', async (_e, projectPath: string, resPath: string) => {
  try {
    // res:// 路径 → 实际文件路径
    const relativePath = resPath.replace(/^res:\/\//, '');
    const fullPath = path.join(projectPath, relativePath);
    const buffer = fs.readFileSync(fullPath);
    const ext = path.extname(fullPath).toLowerCase();
    const mime = ext === '.png' ? 'image/png' :
                 ext === '.svg' ? 'image/svg+xml' :
                 'image/png';
    const base64 = `data:${mime};base64,${buffer.toString('base64')}`;
    return { ok: true, base64 };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});
```

### 6.4 Canvas 渲染引擎设计

```typescript
// Canvas 渲染核心逻辑

interface TilesetCanvasState {
  // 纹理
  textureImage: HTMLImageElement | null;
  textureSize: { w: number; h: number };

  // 网格
  regionSize: { x: number; y: number };   // texture_region_size
  margins: { x: number; y: number };
  separation: { x: number; y: number };

  // 图块数据
  tiles: Map<string, TileEntry>;           // key: "col:row"

  // 视图
  zoom: number;
  panX: number;
  panY: number;

  // 选择
  selectedCoords: { col: number; row: number } | null;
  selectedAlternative: number;

  // 碰撞编辑模式
  collisionEditMode: boolean;
  collisionVertices: Array<{x: number, y: number}>;  // 当前编辑的顶点
  draggingVertexIndex: number;
}

interface TileEntry {
  col: number;
  row: number;
  sizeInAtlas: { x: number; y: number };
  nextAlternativeId: number;
  alternatives: Map<number, TileAlternativeData>;
  // 动画
  animationColumns?: number;
  animationSeparation?: { x: number; y: number };
  animationSpeed?: number;
  animationFramesCount?: number;
}

interface TileAlternativeData {
  id: number;
  probability: number;
  flipH: boolean;
  flipV: boolean;
  transpose: boolean;
  textureOrigin: { x: number; y: number };
  modulate: { r: number; g: number; b: number; a: number };
  zIndex: number;
  ySortOrigin: number;
  terrainSet: number;
  terrain: number;
  physicsLayers: PhysicsLayerData[];
  navigationLayers: NavigationLayerData[];
  occlusionLayers: OcclusionLayerData[];
  customData: Record<string, any>;
}

/** Canvas 绘制函数 */
function render(ctx: CanvasRenderingContext2D, state: TilesetCanvasState): void {
  const { textureImage, regionSize, margins, zoom, panX, panY } = state;

  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.save();
  ctx.translate(panX, panY);
  ctx.scale(zoom, zoom);

  // 1. 绘制纹理
  if (textureImage) {
    ctx.drawImage(textureImage, 0, 0);
  }

  // 2. 绘制网格线
  const cols = Math.floor(textureImage!.width / regionSize.x);
  const rows = Math.floor(textureImage!.height / regionSize.y);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.lineWidth = 1 / zoom;

  for (let c = 0; c <= cols; c++) {
    const x = margins.x + c * (regionSize.x + state.separation.x);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, textureImage!.height);
    ctx.stroke();
  }
  for (let r = 0; r <= rows; r++) {
    const y = margins.y + r * (regionSize.y + state.separation.y);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(textureImage!.width, y);
    ctx.stroke();
  }

  // 3. 高亮已定义的图块
  state.tiles.forEach((tile, _key) => {
    const tileX = margins.x + tile.col * (regionSize.x + state.separation.x);
    const tileY = margins.y + tile.row * (regionSize.y + state.separation.y);
    const tileW = tile.sizeInAtlas.x * regionSize.x +
                  (tile.sizeInAtlas.x - 1) * state.separation.x;
    const tileH = tile.sizeInAtlas.y * regionSize.y +
                  (tile.sizeInAtlas.y - 1) * state.separation.y;

    // 半透明绿色覆盖
    ctx.fillStyle = 'rgba(0, 255, 0, 0.15)';
    ctx.fillRect(tileX, tileY, tileW, tileH);
    ctx.strokeStyle = 'rgba(0, 255, 0, 0.6)';
    ctx.strokeRect(tileX, tileY, tileW, tileH);

    // 坐标标签
    ctx.fillStyle = '#fff';
    ctx.font = `${10 / zoom}px monospace`;
    ctx.fillText(`${tile.col}:${tile.row}`, tileX + 2, tileY + 12 / zoom);
  });

  // 4. 选中高亮
  if (state.selectedCoords) {
    const sel = state.selectedCoords;
    const sx = margins.x + sel.col * (regionSize.x + state.separation.x);
    const sy = margins.y + sel.row * (regionSize.y + state.separation.y);
    const tile = state.tiles.get(`${sel.col}:${sel.row}`);
    const sw = (tile?.sizeInAtlas.x ?? 1) * regionSize.x;
    const sh = (tile?.sizeInAtlas.y ?? 1) * regionSize.y;

    ctx.strokeStyle = '#4A9EFF';
    ctx.lineWidth = 2 / zoom;
    ctx.strokeRect(sx, sy, sw, sh);
  }

  ctx.restore();
}
```

### 6.5 .tres 解析与生成

#### 6.5.1 解析器核心逻辑

```typescript
interface TresData {
  header: {
    type: string;
    format: number;
    uid: string;
  };
  extResources: Map<string, ExtResourceEntry>;  // id → entry
  subResources: Map<string, SubResourceEntry>;  // id → entry
  rootProperties: Record<string, string>;       // key → raw value string
}

interface ExtResourceEntry {
  type: string;
  uid: string;
  path: string;
  id: string;
}

interface SubResourceEntry {
  type: string;
  id: string;
  properties: Record<string, string>;  // key → raw value string
}

/** 解析 .tres 文件内容 */
function parseTres(content: string): TresData {
  const lines = content.split('\n');
  const result: TresData = {
    header: { type: '', format: 3, uid: '' },
    extResources: new Map(),
    subResources: new Map(),
    rootProperties: {},
  };

  let currentSection: 'none' | 'ext_resource' | 'sub_resource' | 'resource' = 'none';
  let currentSubId = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';')) continue;

    // 段头匹配
    const gdResMatch = trimmed.match(/^\[gd_resource\s+(.*)\]$/);
    if (gdResMatch) {
      currentSection = 'none';
      parseGdResourceAttrs(gdResMatch[1], result.header);
      continue;
    }

    const extResMatch = trimmed.match(/^\[ext_resource\s+(.*)\]$/);
    if (extResMatch) {
      currentSection = 'ext_resource';
      const entry = parseExtResourceAttrs(extResMatch[1]);
      result.extResources.set(entry.id, entry);
      continue;
    }

    const subResMatch = trimmed.match(/^\[sub_resource\s+(.*)\]$/);
    if (subResMatch) {
      currentSection = 'sub_resource';
      const entry = parseSubResourceAttrs(subResMatch[1]);
      result.subResources.set(entry.id, entry);
      currentSubId = entry.id;
      continue;
    }

    if (trimmed === '[resource]') {
      currentSection = 'resource';
      continue;
    }

    // 属性行
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;

    const key = trimmed.substring(0, eqIdx).trim();
    const value = trimmed.substring(eqIdx + 1).trim();

    if (currentSection === 'sub_resource' && currentSubId) {
      result.subResources.get(currentSubId)!.properties[key] = value;
    } else if (currentSection === 'resource') {
      result.rootProperties[key] = value;
    }
  }

  return result;
}
```

#### 6.5.2 Tileset 特定数据提取

```typescript
/** 从 sub_resource 的 properties 中提取图块数据 */
function extractTilesFromAtlasSource(
  properties: Record<string, string>
): Map<string, TileEntry> {
  const tiles = new Map<string, TileEntry>();
  const altDataPattern = /^(\d+):(\d+)\/(\d+)(?:\/(.+))?$/;

  for (const [key, value] of Object.entries(properties)) {
    // 跳过非图块属性
    if (['texture', 'texture_region_size', 'margins', 'separation',
         'use_texture_padding'].includes(key)) continue;

    const match = key.match(altDataPattern);
    if (!match) continue;

    const [, colStr, rowStr, altStr, propPath] = match;
    const col = parseInt(colStr);
    const row = parseInt(rowStr);
    const altId = parseInt(altStr);
    const coordKey = `${col}:${row}`;

    if (!tiles.has(coordKey)) {
      tiles.set(coordKey, {
        col, row,
        sizeInAtlas: { x: 1, y: 1 },
        nextAlternativeId: 0,
        alternatives: new Map(),
      });
    }

    const tile = tiles.get(coordKey)!;

    if (propPath) {
      // 处理嵌套属性路径
      applyTileProperty(tile, altId, propPath, value);
    } else {
      // 无路径 = 图块存在标记 / 概率权重
      if (altId === 0) {
        // 主图块标记，value 通常为 "0"
      } else {
        tile.nextAlternativeId = Math.max(tile.nextAlternativeId, altId + 1);
        const alt = getOrCreateAlternative(tile, altId);
        alt.probability = parseFloat(value) || 1.0;
      }
    }
  }

  return tiles;
}

function applyTileProperty(
  tile: TileEntry,
  altId: number,
  propPath: string,
  rawValue: string
): void {
  // 图块级别属性（非 alternative 相关）
  if (altId === 0 && propPath === 'size_in_atlas') {
    tile.sizeInAtlas = parseVector2i(rawValue);
    return;
  }
  if (altId === 0 && propPath === 'next_alternative_id') {
    tile.nextAlternativeId = parseInt(rawValue);
    return;
  }
  // 动画属性...（省略）

  // Alternative 级别属性
  const alt = getOrCreateAlternative(tile, altId);

  switch (propPath) {
    case 'texture_origin':  alt.textureOrigin = parseVector2i(rawValue); break;
    case 'probability':     alt.probability = parseFloat(rawValue); break;
    case 'flip_h':          alt.flipH = rawValue === 'true'; break;
    case 'flip_v':          alt.flipV = rawValue === 'true'; break;
    case 'transpose':       alt.transpose = rawValue === 'true'; break;
    case 'z_index':         alt.zIndex = parseInt(rawValue); break;
    case 'y_sort_origin':   alt.ySortOrigin = parseInt(rawValue); break;
    case 'modulate':        alt.modulate = parseColor(rawValue); break;
    case 'terrain_set':     alt.terrainSet = parseInt(rawValue); break;
    case 'terrain':         alt.terrain = parseInt(rawValue); break;
    default:
      // 处理嵌套路径: physics_layer_0/polygon_0/points
      if (propPath.startsWith('physics_layer_')) {
        parsePhysicsProperty(alt, propPath, rawValue);
      } else if (propPath.startsWith('navigation_layer_')) {
        parseNavigationProperty(alt, propPath, rawValue);
      } else if (propPath.startsWith('occlusion_layer_')) {
        parseOcclusionProperty(alt, propPath, rawValue);
      }
      break;
  }
}
```

#### 6.5.3 .tres 序列化生成

```typescript
/** 将内存数据结构序列化为 .tres 文本 */
function serializeTres(data: TresData, atlasData: Map<string, TileEntry>): string {
  const lines: string[] = [];

  // 1. 文件头
  lines.push(`[gd_resource type="${data.header.type}" format=3 uid="${data.header.uid}"]`);
  lines.push('');

  // 2. 外部资源
  for (const [, ext] of data.extResources) {
    lines.push(`[ext_resource type="${ext.type}" uid="${ext.uid}" path="${ext.path}" id="${ext.id}"]`);
    lines.push('');
  }

  // 3. 子资源（TileSetAtlasSource）
  for (const [, sub] of data.subResources) {
    lines.push(`[sub_resource type="${sub.type}" id="${sub.id}"]`);

    // 3a. 基本属性
    for (const [key, val] of Object.entries(sub.properties)) {
      if (['texture', 'texture_region_size', 'margins', 'separation',
           'use_texture_padding'].includes(key)) {
        lines.push(`${key} = ${val}`);
      }
    }

    // 3b. 图块条目（按坐标排序输出）
    const sortedTiles = [...atlasData.entries()]
      .sort(([a], [b]) => {
        const [ac, ar] = a.split(':').map(Number);
        const [bc, br] = b.split(':').map(Number);
        return ar !== br ? ar - br : ac - bc;
      });

    for (const [_key, tile] of sortedTiles) {
      // size_in_atlas
      if (tile.sizeInAtlas.x !== 1 || tile.sizeInAtlas.y !== 1) {
        lines.push(`${tile.col}:${tile.row}/size_in_atlas = Vector2i(${tile.sizeInAtlas.x}, ${tile.sizeInAtlas.y})`);
      }

      // next_alternative_id
      if (tile.nextAlternativeId > 1) {
        lines.push(`${tile.col}:${tile.row}/next_alternative_id = ${tile.nextAlternativeId}`);
      }

      // 各 alternative
      const sortedAlts = [...tile.alternatives.entries()]
        .sort(([a], [b]) => a - b);

      for (const [altId, alt] of sortedAlts) {
        // 图块存在标记
        lines.push(`${tile.col}:${tile.row}/${altId} = ${alt.probability}`);

        // TileData 属性
        serializeTileDataProperties(lines, tile.col, tile.row, altId, alt);
      }
    }

    lines.push('');
  }

  // 4. 根资源
  lines.push('[resource]');
  for (const [key, val] of Object.entries(data.rootProperties)) {
    lines.push(`${key} = ${val}`);
  }

  return lines.join('\n') + '\n';
}

function serializeTileDataProperties(
  lines: string[],
  col: number, row: number, altId: number,
  data: TileAlternativeData
): void {
  const prefix = `${col}:${row}/${altId}`;

  // 基础属性（仅非默认值时才输出）
  if (data.textureOrigin.x !== 0 || data.textureOrigin.y !== 0)
    lines.push(`${prefix}/texture_origin = Vector2i(${data.textureOrigin.x}, ${data.textureOrigin.y})`);
  if (data.flipH)
    lines.push(`${prefix}/flip_h = true`);
  if (data.flipV)
    lines.push(`${prefix}/flip_v = true`);
  if (data.transpose)
    lines.push(`${prefix}/transpose = true`);
  if (data.zIndex !== 0)
    lines.push(`${prefix}/z_index = ${data.zIndex}`);
  if (data.ySortOrigin !== 0)
    lines.push(`${prefix}/y_sort_origin = ${data.ySortOrigin}`);
  if (data.modulate.r !== 1 || data.modulate.g !== 1 ||
      data.modulate.b !== 1 || data.modulate.a !== 1)
    lines.push(`${prefix}/modulate = Color(${data.modulate.r}, ${data.modulate.g}, ${data.modulate.b}, ${data.modulate.a})`);
  if (data.terrainSet !== -1)
    lines.push(`${prefix}/terrain_set = ${data.terrainSet}`);
  if (data.terrain !== -1)
    lines.push(`${prefix}/terrain = ${data.terrain}`);

  // 物理多边形
  data.physicsLayers.forEach((layer, li) => {
    layer.polygons.forEach((poly, pi) => {
      const flatPts = poly.points.flatMap(p => [p.x, p.y]).join(', ');
      lines.push(`${prefix}/physics_layer_${li}/polygon_${pi}/points = PackedVector2Array(${flatPts})`);
      if (poly.oneWay)
        lines.push(`${prefix}/physics_layer_${li}/polygon_${pi}/one_way = true`);
      if (poly.oneWayMargin !== 1.0)
        lines.push(`${prefix}/physics_layer_${li}/polygon_${pi}/one_way_margin = ${poly.oneWayMargin}`);
    });
  });

  // 自定义数据
  for (const [layerName, value] of Object.entries(data.customData)) {
    const serialized = serializeVariant(value);
    lines.push(`${prefix}/custom_data/${layerName} = ${serialized}`);
  }
}

/** 将 JS 值序列化为 Godot Variant 文本 */
function serializeVariant(value: any): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(value);
  if (typeof value === 'string') return `"${value}"`;
  if (Array.isArray(value)) {
    if (value.every(v => typeof v === 'number')) {
      return `PackedFloat64Array(${value.join(', ')})`;
    }
  }
  return String(value);
}
```

### 6.6 Canvas 交互设计

#### 6.6.1 交互功能矩阵

| 操作 | 交互方式 | 说明 |
|------|---------|------|
| **平移视图** | 中键拖拽 / 空格+左键 | 移动画布视口 |
| **缩放** | 滚轮 | 以鼠标位置为中心缩放 |
| **选择图块** | 左键点击网格单元格 | 高亮选中，右侧显示属性 |
| **框选多个图块** | Shift+左键拖拽 | 批量选择 |
| **定义/取消图块** | 双击单元格 | 切换图块存在/不存在 |
| **设置大图块** | 右键拖拽 | 拖拽出覆盖多格的大图块 |
| **编辑碰撞多边形** | 在属性面板点击「编辑碰撞」 | 进入模式后可在 Canvas 直接拖拽顶点 |
| **添加备选图块** | 在属性面板点击「+ 备选」 | 创建新的 alternative |

#### 6.6.2 碰撞多边形编辑

```typescript
/** 处理 Canvas 中碰撞多边形的鼠标交互 */
function handleCollisionEditMouseDown(
  e: MouseEvent,
  canvas: HTMLCanvasElement,
  state: TilesetCanvasState
): void {
  const rect = canvas.getBoundingClientRect();
  const mouseX = (e.clientX - rect.left - state.panX) / state.zoom;
  const mouseY = (e.clientY - rect.top - state.panY) / state.zoom;

  // 转换为图块本地坐标
  const tile = state.tiles.get(`${state.selectedCoords!.col}:${state.selectedCoords!.row}`);
  const regionSize = state.regionSize;
  const tileCenterX = state.margins.x +
    state.selectedCoords!.col * (regionSize.x + state.separation.x) +
    (tile?.sizeInAtlas.x ?? 1) * regionSize.x / 2;
  const tileCenterY = state.margins.y +
    state.selectedCoords!.row * (regionSize.y + state.separation.y) +
    (tile?.sizeInAtlas.y ?? 1) * regionSize.y / 2;

  const localX = mouseX - tileCenterX;
  const localY = mouseY - tileCenterY;

  // 检测是否点击了已有顶点（5px 容差）
  const hitRadius = 5 / state.zoom;
  const vertices = state.collisionVertices;
  for (let i = 0; i < vertices.length; i++) {
    const dx = vertices[i].x - localX;
    const dy = vertices[i].y - localY;
    if (Math.sqrt(dx * dx + dy * dy) < hitRadius) {
      state.draggingVertexIndex = i;  // 开始拖拽该顶点
      return;
    }
  }

  // 未点击顶点：在边缘上插入新顶点
  // ...（省略实现细节）
}
```

### 6.7 渲染进程路由设计

在 X-agent 现有 React 渲染进程中添加 tileset 编辑器路由：

```typescript
// src/main.tsx — 添加路由判断
function AppRouter() {
  const hash = window.location.hash;

  if (hash === '#/tileset-editor') {
    return <TilesetEditor />;
  }

  return <App />;
}
```

### 6.8 关键数据类型工具函数

```typescript
// 解析工具函数
function parseVector2i(raw: string): { x: number; y: number } {
  const m = raw.match(/Vector2i\((-?\d+),\s*(-?\d+)\)/);
  if (!m) throw new Error(`Invalid Vector2i: ${raw}`);
  return { x: parseInt(m[1]), y: parseInt(m[2]) };
}

function parseVector2(raw: string): { x: number; y: number } {
  const m = raw.match(/Vector2\((-?[\d.]+),\s*(-?[\d.]+)\)/);
  if (!m) throw new Error(`Invalid Vector2: ${raw}`);
  return { x: parseFloat(m[1]), y: parseFloat(m[2]) };
}

function parseColor(raw: string): { r: number; g: number; b: number; a: number } {
  const m = raw.match(/Color\(([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)\)/);
  if (!m) throw new Error(`Invalid Color: ${raw}`);
  return { r: parseFloat(m[1]), g: parseFloat(m[2]), b: parseFloat(m[3]), a: parseFloat(m[4]) };
}

function parsePackedVector2Array(raw: string): Array<{ x: number; y: number }> {
  const m = raw.match(/PackedVector2Array\(([^)]*)\)/);
  if (!m) throw new Error(`Invalid PackedVector2Array: ${raw}`);
  const nums = m[1].split(',').map(s => parseFloat(s.trim()));
  const result: Array<{ x: number; y: number }> = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    result.push({ x: nums[i], y: nums[i + 1] });
  }
  return result;
}

function parseExtResource(raw: string): string | null {
  const m = raw.match(/^ExtResource\("([^"]+)"\)$/);
  return m ? m[1] : null;
}

function parseSubResource(raw: string): string | null {
  const m = raw.match(/^SubResource\("([^"]+)"\)$/);
  return m ? m[1] : null;
}
```

---

## 七、.tres 文件完整数据流

```
                    ┌─────────────────────┐
                    │  Godot Editor       │
                    │  保存 TileSet        │
                    └────────┬────────────┘
                             │ 生成 .tres
                             ▼
              ┌──────────────────────────────┐
              │  .tres 文本文件               │
              │  - [gd_resource]             │
              │  - [ext_resource] 纹理引用    │
              │  - [sub_resource] AtlasSource│
              │  - [resource] 根属性         │
              └──────────┬───────────────────┘
                         │
          ┌──────────────┼──────────────┐
          │ 前端工具读取   │              │  Godot 加载
          ▼              │              ▼
┌─────────────────┐     │     ┌─────────────────┐
│ parseTres()     │     │     │ ResourceLoader  │
│ → TresData      │     │     │ 内部反序列化    │
│ → Map<TileEntry>│     │     └─────────────────┘
└────────┬────────┘     │
         │ 用户编辑      │
         ▼              │
┌─────────────────┐     │
│ Canvas 交互      │     │
│ 属性面板修改     │     │
└────────┬────────┘     │
         │ 保存         │
         ▼              │
┌─────────────────┐     │
│ serializeTres() │     │
│ → .tres 文本    │     │
└────────┬────────┘     │
         │              │
         ▼              │
┌─────────────────┐     │
│ writeTileset()  │     │
│ 写入磁盘 .tres  │     │
└─────────────────┘     │
         │              │
         │ Godot 热重载  │
         ▼              ▼
┌─────────────────────────────┐
│  TileMap 即时反映修改        │
└─────────────────────────────┘
```

---

## 八、总结

### 8.1 关键发现

1. **.tres 是结构化的文本格式**：完全可解析、可生成，无需 Godot 编辑器参与即可读写
2. **图块数据使用扁平路径存储**：`col:row/alt_id/property_path` 格式，规则清晰
3. **PackedVector2Array 是平铺的坐标列表**：`PackedVector2Array(x1, y1, x2, y2, ...)`，每 2 个数字为一组
4. **UID 是 35 字符 Base 编码的 63-bit 整数**：JavaScript 可用 BigInt 实现编解码
5. **备选图块是概率选择机制**：同一坐标下可有多个 TileData 配置，ID=0 为主图块
6. **碰撞多边形使用本地坐标系**：原点在图块中心，Canvas 渲染时需坐标转换

### 8.2 前端工具可行方案

| 层面 | 方案 |
|------|------|
| **窗口管理** | Electron `new BrowserWindow()` + 独立 hash 路由 `/tileset-editor` |
| **纹理加载** | 主进程 IPC `readTextureBase64`: `res://` → 文件系统绝对路径 → base64 data URL |
| **Canvas 渲染** | 纹理图 + 半透明网格线 + 图块标记覆盖 + 碰撞多边形叠加层 |
| **数据解析** | 正则匹配 `.tres` 格式，按正则 `(\d+):(\d+)/(\d+)(?:/(.+))?` 提取图块路径 |
| **数据生成** | 按排序规则输出属性行，仅输出非默认值以保持最小差异 |
| **UID 生成** | 纯 JavaScript BigInt 实现，无需调用 Godot |

### 8.3 与现有 X-agent 的集成点

- **主进程**：新增 TilesetEditor 相关的 IPC handler + 窗口管理
- **Preload**：扩展 `XAgentApi` 接口，新增 tileset 相关方法
- **渲染进程**：新增 `#/tileset-editor` 路由和独立 React 组件
- **Godot RPC**（未来）：可通过 `godot_import_resources` 触发 Godot 的 `.tres` 重载

---

## 相关文件

- `D:\软件安装程序\godot\docs\doc\classes\TileSet.xml` — TileSet API 参考
- `D:\软件安装程序\godot\docs\doc\classes\TileData.xml` — TileData API 参考
- `D:\软件安装程序\godot\docs\doc\classes\TileSetAtlasSource.xml` — TileSetAtlasSource API 参考
- `E:\workspace\TestProjects\godot_test\godot-test-4.7\room_builder_tileset.tres` — 实际 .tres 示例
- `E:\workspace\TestProjects\godot_test\godot-test-4.7\item_tile_set.tres` — 含大图块/备选图块示例
- `E:\workspace\TestProjects\godot_test\godot-test-4.7\new_tile_set.tres` — 含物理碰撞示例
- [Godot ResourceUID 源码](https://github.com/godotengine/godot/blob/master/core/io/resource_uid.cpp)
- [Godot TSCN 文件格式](https://docs.godotengine.org/en/4.x/contributing/development/file_formats/tscn.html)
