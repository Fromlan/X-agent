---
name: godot-shader-patterns
description: Godot 4 shader recipes: outline, pixelate, dissolve, water, blur. Use when implementing common VFX/post-process canvas_item or spatial shaders.
---

# Godot Shader 常用案例

## 1. 描边着色器（轮廓检测）

### 效果描述
为精灵或字体添加外轮廓效果，常用于 UI 元素、选中状态或卡通风格的描边效果。

### 核心代码

```gdscript
shader_type canvas_item;

uniform float outline_width = 1.0;
uniform vec4 outline_color: source_color = vec4(1, 0, 0, 1);

void fragment() {
    vec2 uv = UV;
    vec2 uv_up = uv + vec2(0, TEXTURE_PIXEL_SIZE.y) * outline_width;
    vec2 uv_down = uv + vec2(0, -TEXTURE_PIXEL_SIZE.y) * outline_width;
    vec2 uv_left = uv + vec2(TEXTURE_PIXEL_SIZE.x, 0) * outline_width;
    vec2 uv_right = uv + vec2(-TEXTURE_PIXEL_SIZE.x, 0) * outline_width;

    vec4 color_up = texture(TEXTURE, uv_up);
    vec4 color_down = texture(TEXTURE, uv_down);
    vec4 color_left = texture(TEXTURE, uv_left);
    vec4 color_right = texture(TEXTURE, uv_right);

    vec4 outline = color_down + color_up + color_left + color_right;
    outline.rgb = outline_color.rgb;

    vec4 original_color = texture(TEXTURE, UV);
    COLOR = mix(outline, original_color, original_color.a);
}
```

## 2. 像素化着色器

### 效果描述
将画面处理成像素风格，模拟复古游戏的视觉效果。

### 核心代码

```gdscript
shader_type canvas_item;

uniform float pixel_size = 4.0;  // 像素块大小

void fragment() {
    vec2 uv = floor(UV * pixel_size) / pixel_size;
    COLOR = texture(TEXTURE, uv);
}
```

## 3. 灰度/复古色着色器

### 效果描述
将图片转换为灰度图或带有复古色调。

### 核心代码

```gdscript
shader_type canvas_item;

void fragment() {
    vec4 color = texture(TEXTURE, UV);
    float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    COLOR = vec4(vec3(gray), color.a);
}
```

## 4. 溶解/燃烧效果

### 效果描述
实现物体逐渐溶解消失的效果，溶解边缘带有燃烧的色泽。

### 核心代码

```gdscript
shader_type canvas_item;

uniform sampler2D dissolve_texture: source_color;
uniform float dissolve_value: hint_range(0, 1) = 1.0;
uniform float burn_size: hint_range(0.0, 1.0, 0.01) = 0.1;
uniform vec4 burn_color: source_color = vec4(1.0, 0.3, 0.0, 1.0);

void fragment() {
    vec4 main_texture = texture(TEXTURE, UV);
    vec4 noise_texture = texture(dissolve_texture, UV);

    float burn_size_step = burn_size * step(0.001, dissolve_value) * step(dissolve_value, 0.999);
    float threshold = smoothstep(noise_texture.x - burn_size_step, noise_texture.x, dissolve_value);
    float border = smoothstep(noise_texture.x, noise_texture.x + burn_size_step, dissolve_value);

    COLOR.a *= threshold;
    COLOR.rgb = mix(burn_color.rgb, main_texture.rgb, border);
}
```

### 使用说明
1. 创建 `NoiseTexture2D` 作为 `dissolve_texture`
2. 使用 "Simplex Smooth" 噪声类型
3. 调整 `dissolve_value`（0 = 完全溶解，1 = 未溶解）

## 5. 水波/折射效果

### 效果描述
模拟水面的波纹效果，包含波动和扭曲效果。

### 核心代码

```gdscript
shader_type canvas_item;

uniform sampler2D noise_tex;
uniform float speed = 0.25;
uniform float strength = 0.02;
uniform vec4 tint_color: source_color = vec4(1.0, 1.0, 1.0, 1.0);

void fragment() {
    vec2 uv = UV;

    float noise = texture(noise_tex, uv + vec2(TIME * speed, 0.0)).r;
    float noise2 = texture(noise_tex, uv + vec2(0.0, TIME * speed * 0.5)).r;

    vec2 offset = vec2(
        cos(TIME * speed + uv.y * 10.0) * strength,
        sin(TIME * speed + uv.x * 10.0) * strength
    ) * (noise + noise2);

    vec4 color = texture(TEXTURE, uv + offset);
    COLOR = color * tint_color;
}
```

## 6. 模糊效果

### 效果描述
对图像进行模糊处理，常用于景深效果、UI 毛玻璃效果。

### 核心代码

```gdscript
shader_type canvas_item;

uniform float blur_radius = 2.0;
uniform vec2 blur_direction = vec2(1.0, 0.0);

const float MATRIX[5] = float[](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);

void fragment() {
    vec2 uv = UV;
    vec2 texel_size = TEXTURE_PIXEL_SIZE;

    vec3 result = texture(TEXTURE, uv).rgb * MATRIX[0];

    for (int i = 1; i < 5; i++) {
        float offset = float(i) * blur_radius;
        result += texture(TEXTURE, uv + texel_size * offset * blur_direction).rgb * MATRIX[i];
        result += texture(TEXTURE, uv - texel_size * offset * blur_direction).rgb * MATRIX[i];
    }

    vec4 original = texture(TEXTURE, uv);
    COLOR = vec4(result, original.a);
}
```

## 7. 发光/光晕效果

### 效果描述
为图像添加发光效果，常用于霓虹灯、魔法特效或 UI 高亮显示。

### 核心代码

```gdscript
shader_type canvas_item;

uniform float glow_intensity = 0.5;
uniform float glow_radius = 3.0;

void fragment() {
    vec2 uv = UV;
    vec2 texel = TEXTURE_PIXEL_SIZE * glow_radius;

    vec4 color = texture(TEXTURE, uv);

    vec3 glow = vec3(0.0);
    for (float x = -2.0; x <= 2.0; x += 1.0) {
        for (float y = -2.0; y <= 2.0; y += 1.0) {
            vec2 offset = vec2(x, y) * texel;
            glow += texture(TEXTURE, uv + offset).rgb;
        }
    }
    glow /= 25.0;

    COLOR = color + vec4(glow * glow_intensity, 0.0);
}
```

### 流光效果

```gdscript
shader_type canvas_item;

uniform sampler2D light_vector;
uniform float width = 0.08;
uniform vec4 flowlight = vec4(0.3, 0.3, 0.0, 0.3);

void fragment() {
    vec4 color = texture(TEXTURE, UV);

    if (color.a != 0.0) {
        float v = texture(light_vector, UV).r;
        float diff = v - cos(TIME * 0.5);

        if (abs(diff) < width) {
            color = color + mix(flowlight, vec4(0.0), abs(diff) / width);
        }
    }

    COLOR = color;
}
```

## 8. 卡通渲染（Cel Shading）

### 效果描述
模拟卡通/动漫风格的渲染效果，通过离散的色调过渡创造手绘感。

### 核心代码

```gdscript
shader_type canvas_item;

uniform float levels = 3.0;
uniform vec4 light_color: source_color = vec4(1.0, 1.0, 1.0, 1.0);
uniform vec4 shadow_color: source_color = vec4(0.2, 0.2, 0.3, 1.0);

void fragment() {
    vec4 color = texture(TEXTURE, UV);
    float light = dot(color.rgb, vec3(0.33));
    light = floor(light * levels) / levels;
    COLOR = mix(shadow_color, color * light_color, light);
}
```

## 9. SpriteSheet 帧动画

### 效果描述
通过 Shader 实现 SpriteSheet 图集的帧动画播放。

### 核心代码

```gdscript
shader_type canvas_item;

uniform int h_frames : hint_range(1, 100) = 4;
uniform int v_frames : hint_range(1, 100) = 1;
uniform float speed : hint_range(0.1, 30.0) = 10.0;
uniform bool loop = true;

void fragment() {
    float frame_width = 1.0 / float(h_frames);
    float frame_height = 1.0 / float(v_frames);

    int total_frames = h_frames * v_frames;
    int frame_index;

    if (loop) {
        frame_index = int(TIME * speed) % total_frames;
    } else {
        frame_index = min(int(TIME * speed), total_frames - 1);
    }

    int col = frame_index % h_frames;
    int row = frame_index / h_frames;

    float uv_x = float(col) * frame_width;
    float uv_y = 1.0 - float(row + 1) * frame_height;

    vec2 anim_uv = vec2(uv_x, uv_y) + vec2(UV.x * frame_width, UV.y * frame_height);
    COLOR = texture(TEXTURE, anim_uv);
}
```

## 10. 混合模式

### 效果描述
实现 Photoshop 风格的混合模式。

### 核心代码

```gdscript
shader_type canvas_item;

uniform sampler2D blend_texture: source_color;
uniform float opacity: hint_range(0.0, 1.0) = 1.0;
uniform int blend_mode = 0;

vec3 multiply(vec3 base, vec3 blend) {
    return base * blend;
}

vec3 screen(vec3 base, vec3 blend) {
    return 1.0 - (1.0 - base) * (1.0 - blend);
}

vec3 overlay(vec3 base, vec3 blend) {
    return mix(
        2.0 * base * blend,
        1.0 - 2.0 * (1.0 - base) * (1.0 - blend),
        step(0.5, base)
    );
}

void fragment() {
    vec4 base = texture(TEXTURE, UV);
    vec4 blend = texture(blend_texture, UV);

    vec3 result;
    if (blend_mode == 0) {
        result = multiply(base.rgb, blend.rgb);
    } else if (blend_mode == 1) {
        result = screen(base.rgb, blend.rgb);
    } else {
        result = overlay(base.rgb, blend.rgb);
    }

    COLOR = vec4(mix(base.rgb, result, opacity * blend.a), base.a);
}
```

## 11. SDF 描边效果（3D）

```gdscript
shader_type spatial;
render_mode cull_front, unshaded;

uniform vec4 outline_color : hint_color = vec4(1.0, 0.0, 0.0, 1.0);
uniform float grow = 0.05;

void vertex() {
    VERTEX += NORMAL * grow;
}

void fragment() {
    ALBEDO = outline_color.rgb;
}
```
