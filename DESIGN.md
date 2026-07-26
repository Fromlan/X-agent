# X-agent 设计系统

> 视觉语言对齐 [Cindy Design System](https://github.com/makecindy/cindy/blob/main/docs/design-rules/DESIGN.md) 的 Default Light/Dark：近单色画布、扁平分层、pill 交互几何、页面内无阴影。组件不写死颜色，一律引用 CSS 变量。品牌仍为 X-agent（不采用 CINDY 品牌红皮肤族）。

---

## 一、设计原则

1. **深色优先**：`:root` 为深色；`body[data-theme="light"]` 覆盖为浅色。
2. **近单色**：默认灰阶；彩度仅用于已登记的语义信号（focus、running/warning、status、diff）。
3. **Token 驱动**：颜色 / 圆角 / 阴影走 CSS 变量；改主题只改 token。
4. **扁平分层**：全窗 Surface 底 + 1px Board 分割；抬起控件用 Card，不用背景色块切页。
5. **零阴影（页面内）**：深度靠边框与 Surface/Card 差；仅 modal 浮层可用 gated shadow。
6. **Pill 优先**：按钮、chip、单行 input、tab 用 `9999px`；容器 12px；多行控件 8px。
7. **字重克制**：UI 仅 400 / 500；不用 600+。
8. **图标**：优先 `lucide-react`；状态用色点 / 语义色，不用 emoji。

---

## 二、色彩系统

### 2.1 三层 Surface（Cindy 层系统）

| 角色 | Light | Dark | Token 映射 |
|---|---|---|---|
| **Surface** | `#f8f8f6` | `#1f1f1e` | `--bg-app` / `--bg-sidebar` / `--bg-main` |
| **Card** | `#ffffff` | `#2c2c2a` | `--bg-header` / `--bg-input` / `--bg-modal` / composer |
| **Board** | `#d7d7d4` | `#3c3c3a` | `--border-primary` / `--border-input` |
| **Chip** | `#e5e5e5` | `#3c3c3a` | `--bg-list-hover` / `--surface-chip`；选中用略抬升的 `--bg-list-selected` |

全窗应用结构用单一 Surface，区域边界只用 1px Board，不用背景色差切页。

### 2.2 文本

| Token | 深色 | 浅色 | 用途 |
|---|---|---|---|
| `--text-primary` | `#d4d4d4` | `#262626` | 主文本 |
| `--text-secondary` | `#a3a3a3` | `#525252` | 次要文本 |
| `--text-muted` | `#737373` | `#737373` | 弱化 |
| `--text-dim` | `#737373` | `#a3a3a3` | 时间戳等 |
| `--text-placeholder` | `#525252` | `#c4c4c4` | 占位符 |
| `--text-code` | `#d4d4d4` | `#262626` | 内联代码（灰阶；语法高亮除外） |
| `--text-error` | `#ff7b72` | `#b31d28` | 错误文本 |

### 2.3 语义色（仅登记用途）

| Token | 值 | 用途 |
|---|---|---|
| `--focus-ring` | `#417CDD` | 键盘 focus 边框 |
| `--focus-ring-soft` | `rgba(65,124,221,0.5)` | focus 光晕 |
| `--warning-accent` | `#EA6B17` | 运行中 / thinking 状态条 |
| `--accent-green` | `#2AAE5B` | 空闲 / 成功 |
| `--accent-red` | `#D91F37` | 危险 / 错误 |
| `--accent-yellow` | `#F3A115` | 启动中 |
| `--accent-blue` | `#417CDD` | 仅 focus / 链接；**不作主按钮底** |
| `--accent-gray` | `#737373` | 中性 |

兼容别名：`--accent-purple` 映射到 `--text-secondary`（不再使用紫色强调）。

### 2.4 按钮与叠层

| Token | 深色 | 浅色 |
|---|---|---|
| `--btn-bg` | `#ffffff` | `#000000` | CTA pill |
| `--btn-text` | `#000000` | `#ffffff` |
| `--surface-chip` | `#3c3c3a` | `#e5e5e5` | Primary 灰 pill / chip |
| `--overlay-bg` | `rgb(0 0 0 / .45)` | `rgb(0 0 0 / .35)` |
| `--scrollbar-thumb` | `rgb(255 255 255 / 12%)` | `rgb(0 0 0 / 12%)` |

### 2.5 气泡

| Token | 说明 |
|---|---|
| `--bubble-user` | Chip 底（灰阶，非蓝调） |
| `--bubble-text` | Card 抬起 |
| `--bubble-thinking` | Surface 略暗 + warning 左边线可选 |
| `--bubble-tool` | Card + Board 边 |
| `--bubble-result` | `--bg-result` |

### 2.6 会话状态色

| 状态 | Token | 脉冲 |
|---|---|---|
| 启动中 | `--accent-yellow` | 否 |
| 空闲 | `--accent-green` | 否 |
| 运行中 | `--warning-accent` | 是 |
| 错误 / 退出 | `--accent-red` | 否 |

颜色由 CSS 类绑定 token，禁止在 JS 中写死色值。

---

## 三、字体

```css
--font-sans: "Inter", system-ui, -apple-system, "Segoe UI",
             "PingFang SC", "Hiragino Sans", "Microsoft YaHei", sans-serif;
--font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas,
             "Courier New", monospace;
```

- 正文：Inter 400 / 500。
- 等宽：JetBrains Mono（代码、工具参数、路径）。
- 全局：`font-size: 13px; line-height: 1.5`。
- 数字对齐：`font-family: var(--font-mono); font-variant-numeric: tabular-nums`。

---

## 四、圆角（仅三档）

| Token | 值 | 用途 |
|---|---|---|
| `--radius-control` | 8px | textarea、气泡、菜单行高亮 |
| `--radius-container` | 12px | 卡片、代码块、模态、工具卡 |
| `--radius-pill` | 9999px | 按钮、chip、单行 input、tab、nav cell |

兼容别名：`--radius-sm` / `--radius-md` → control；`--radius-lg` → control（气泡）；`--radius-xl` / `--radius-2xl` → container。

---

## 五、阴影

| Token | 用途 |
|---|---|
| `--shadow-sm` / `--shadow-md` | `none`（页面内禁止） |
| `--shadow-lg` | 仅 settings / confirm 模态浮层 |

Focus 光晕用 `--focus-ring-soft`，不算装饰阴影。

---

## 六、布局壳层

```
TopBar → [banners] → main-row
  ├── Sidebar（会话列表，~260px）
  ├── Chat
  └── RightPanel（可选，~300px；默认折叠；Tools / Files / Godot 三页签）
```

- 区域分割：`1px solid var(--border-primary)`。
- Settings：仍为居中模态（非全屏路由）；左侧 nav 用 pill 选中态。
- 右栏：`ClientPrefs.rightPanelOpen`；窄窗（≤960px）隐藏右栏。
  - **Tools**：当前回合工具调用详情
  - **Files**：项目文件树、预览、右键（加入对话 / 资源管理器 / 复制路径）
  - **Godot**：RPC 桥接状态、Ping、客户端列表（完整控制面在设置 → Godot RPC）

---

## 七、通用组件约定

### 7.1 按钮

| 类型 | 样式 | 用途 |
|---|---|---|
| Primary | `--surface-chip` pill | 常见主操作 |
| CTA | `--btn-bg` / `--btn-text` 反相 pill | 最高强调（发送等） |
| Secondary | Card + Board 边 pill | 次要 |
| Danger | `--accent-red` pill | 删除 / 中止 |
| Ghost | 透明 pill | 工具栏轻操作 |

统一：`border-radius: var(--radius-pill)`；padding 约 `10px 24px`（sm：`5px 12px`）；过渡 ≤150ms。

### 7.2 消息气泡

- 圆角 `--radius-control`，Board 细边，无阴影。
- 用户：右对齐，chip 底。
- 助手：左对齐，Card。
- 工具卡：`--radius-container` + 左边语义条（运行橙 / 成功绿 / 错误红）。

### 7.3 弹窗与滚动条

- 遮罩：`--overlay-bg`。
- 弹窗：Card + 1px Board + `--radius-container` + `--shadow-lg`。
- 滚动条 thumb：`--scrollbar-thumb`。

---

## 八、动效

- 尊重 `prefers-reduced-motion: reduce`。
- 功能态过渡 ≤150ms（color / background / opacity / border）。
- 运行中状态点可轻脉冲；禁止装饰性大动效。

---

## 九、反模式（禁止）

1. 组件内硬编码颜色 → 用 token。
2. 用 emoji 当 UI 图标。
3. 页面内 `box-shadow`（除 modal / focus ring）。
4. 任意圆角（仅 8 / 12 / 14 档以外的值）或蓝实心主按钮铺满工具栏。
5. 字重 ≥600。
6. 渐变背景装饰。
