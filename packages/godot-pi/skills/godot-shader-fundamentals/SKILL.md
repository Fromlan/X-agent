---
name: godot-shader-fundamentals
description: Godot 4 Shader language basics: types, uniforms, built-ins, tips. Use when writing new shaders or learning Godot shading language fundamentals.
---

# Godot Shader 基础

## 1. Shader 概述

Shader 是一种运行在 GPU 上的特殊程序，负责决定如何处理网格模型的数据（如顶点位置、颜色、法线等）以及如何将它们绘制到屏幕上。Godot 引擎的 Shader 语言基于 GLSL，进行了简化和扩展。

### 为什么使用 Shader

- **高性能**：GPU 并行处理，适合处理大量像素
- **程序化生成**：可以动态生成纹理、颜色、效果
- **视觉效果**：实现光照、阴影、材质等复杂效果
- **实时反馈**：支持时间相关的动态效果

## 2. Shader 类型

Godot 4 支持 5 种 Shader 类型：

### spatial（3D 着色器）

用于 3D 场景中的物体渲染，如网格、地形等。

```gdscript
shader_type spatial;

void vertex() {
    // 顶点着色器：处理每个顶点
}

void fragment() {
    // 片段着色器：处理每个像素
}

void light() {
    // 光照着色器：处理光照计算
}
```

### canvas_item（2D 着色器）

用于 2D 场景中的渲染，如 Sprite2D、Control 组件、ColorRect 等。

```gdscript
shader_type canvas_item;

void vertex() {
    // 顶点着色器
}

void fragment() {
    // 片段着色器
    COLOR = vec4(1.0, 0.0, 0.0, 1.0); // 输出红色
}
```

### particles（粒子着色器）

```gdscript
shader_type particles;

void start() {
    // 粒子产生时调用
}

void process() {
    // 粒子每帧更新时调用
}

void fragment() {
    // 粒子片段着色器
}
```

## 3. 数据类型

### 基础类型

| 类型 | 描述 |
|------|------|
| `void` | 空类型 |
| `bool` | 布尔类型 |
| `int` | 有符号整型 |
| `float` | 浮点数 |
| `bvec2/3/4` | 2/3/4 维布尔向量 |
| `ivec2/3/4` | 2/3/4 维整型向量 |
| `vec2/3/4` | 2/3/4 维浮点向量 |

### 矩阵类型

| 类型 | 描述 |
|------|------|
| `mat2` | 2x2 矩阵 |
| `mat3` | 3x3 矩阵 |
| `mat4` | 4x4 矩阵 |

### 纹理类型

| 类型 | 描述 |
|------|------|
| `sampler2D` | 2D 纹理采样器 |
| `samplerCube` | 立方体纹理采样器 |
| `sampler3D` | 3D 纹理采样器 |

## 4. Uniform 变量

Uniform 变量用于从 CPU 端向 GPU 端传递数据。

```gdscript
shader_type canvas_item;

uniform float my_float = 1.0;
uniform vec4 my_color;
uniform sampler2D my_texture;
```

### Hint 提示

| Hint | 描述 |
|------|------|
| `hint_range(min, max)` | 范围提示 |
| `source_color` | 颜色提示 |
| `hint_albedo` | 纹理提示（默认白色） |
| `hint_normal` | 法线纹理提示 |

```gdscript
uniform vec4 hurt_color : source_color;
uniform float hurt_intensity : hint_range(0.0, 1.0) = 0.0;
uniform float progress : hint_range(0.0, 1.0, 0.1) = 0.5;
```

## 5. 内置全局变量

### 数学常量

| 变量 | 描述 | 值 |
|------|------|-----|
| `PI` | 圆周率 | 3.14159265359 |
| `TAU` | 2倍圆周率 | 6.28318530718 |
| `E` | 自然常数 e | 2.71828182846 |

### 时间相关

| 变量 | 描述 |
|------|------|
| `TIME` | 从游戏开始经过的时间（秒） |
| `FRAME` | 当前帧编号 |

### UV 坐标

| 变量 | 描述 |
|------|------|
| `UV` | 当前像素的 UV 坐标（0.0 ~ 1.0） |

## 6. 基础数学函数

### 绝对值与取整

```glsl
float abs(float x)
float floor(float x)
float ceil(float x)
float round(float x)
float fract(float x)
```

### 极值与限制

```glsl
float min(float x, float y)
float max(float x, float y)
float clamp(float x, min_val, max_val)
float step(float edge, float x)
```

### 插值函数

```glsl
float mix(float x, float y, float alpha)
float smoothstep(float edge0, float edge1, float x)
```

## 7. 三角函数

```glsl
sin(x), cos(x), tan(x)
asin(x), acos(x), atan(x)
```

## 8. 向量运算

### 点乘与叉乘

```glsl
float dot(vec2 x, vec2 y)
vec3 cross(vec3 x, vec3 y)
```

### 长度与归一化

```glsl
float length(vec2 v)
vec2 normalize(vec2 v)
float distance(vec2 a, vec2 b)
```

### 反射与折射

```glsl
vec2 reflect(vec2 I, vec2 N)
vec3 refract(vec3 I, vec3 N, float eta)
```

## 9. UV 操作模式

### 缩放

```gdscript
shader_type canvas_item;

uniform vec2 scale = vec2(2.0, 2.0);
uniform vec2 pivot = vec2(0.5, 0.5);

void vertex() {
    UV -= pivot;
    UV /= scale;
    UV += pivot;
}
```

### 旋转

```gdscript
shader_type canvas_item;
render_mode unshaded;

uniform float angular_speed = 1.0;
uniform vec2 pivot = vec2(0.5, 0.5);

void vertex() {
    UV -= pivot;
    float rot = TIME * angular_speed;
    UV *= mat2(
        vec2(sin(rot), -cos(rot)),
        vec2(cos(rot), sin(rot))
    );
    UV += pivot;
}
```

### 偏移/滚动

```gdscript
shader_type canvas_item;

uniform vec2 scroll_speed = vec2(1, 0.0);

void fragment() {
    vec2 offset_uv = UV + cos(TIME) * scroll_speed;
    COLOR = texture(TEXTURE, offset_uv);
}
```

## 10. 颜色操作

### 灰度处理

```gdscript
shader_type canvas_item;

void fragment() {
    vec4 color = texture(TEXTURE, UV);
    float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    COLOR = vec4(vec3(gray), color.a);
}
```

### 颜色调整

```gdscript
shader_type canvas_item;

uniform float brightness = 0.0;
uniform float contrast = 1.0;
uniform float saturation = 1.0;

void fragment() {
    vec4 color = texture(TEXTURE, UV);
    color.rgb += brightness;
    color.rgb = (color.rgb - 0.5) * contrast + 0.5;
    float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    color.rgb = mix(vec3(gray), color.rgb, saturation);
    COLOR = color;
}
```

## 11. 噪声函数

### 随机数

```glsl
float random(float x) {
    return fract(sin(x) * 43758.5453);
}

float noise(vec2 st) {
    vec2 i = floor(st);
    vec2 f = fract(st);
    float a = random(i);
    float b = random(i + vec2(1.0, 0.0));
    float c = random(i + vec2(0.0, 1.0));
    float d = random(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}
```

### FBM (分形布朗运动)

```glsl
float fbm(vec2 st) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;

    for (int i = 0; i < 6; i++) {
        value += amplitude * noise(st * frequency);
        frequency *= 2.0;
        amplitude *= 0.5;
    }
    return value;
}
```

## 12. 实用技巧

### 创建圆形

```glsl
shader_type canvas_item;

void fragment() {
    vec2 center = vec2(0.5, 0.5);
    float radius = 0.4;
    float dist = length(UV - center);
    float circle = step(radius, dist);
    COLOR = vec4(vec3(circle), 1.0);
}
```

### 波浪效果

```glsl
void fragment() {
    float wave = sin(UV.y * 10.0 + TIME * 2.0) * 0.1 + 0.5;
    COLOR = vec4(vec3(wave), 1.0);
}
```

### 条纹动画

```glsl
void fragment() {
    float stripe = sin(UV.y * 20.0 + TIME * 5.0);
    stripe = stripe * 0.5 + 0.5;
    COLOR = vec4(vec3(stripe), 1.0);
}
```

## 13. 性能优化

### 减少纹理采样

```gdscript
// 错误：多次采样
void fragment() {
    float r = texture(TEXTURE, UV).r;
    float g = texture(TEXTURE, UV + vec2(0.1, 0.0)).g;
}

// 正确：单次采样
void fragment() {
    vec4 tex = texture(TEXTURE, UV);
    float r = tex.r;
    float g = tex.g;
}
```

### 避免分支

```gdscript
// 避免
if (condition) {
    color = a;
} else {
    color = b;
}

// 推荐：使用 step 或 mix
color = mix(a, b, step(threshold, value));
```
