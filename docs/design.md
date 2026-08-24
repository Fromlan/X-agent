# X-agent 设计系统

---

## 一、设计原则

1. **深色优先**：`:root` 为深色回退；`body[data-theme="{themeId}-{colorMode}"]` 覆盖完整 token。
2. **近单色**：默认灰阶；彩度仅用于已登记的语义信号（focus、running/warning、status、diff）。实验主题族可提高语义色饱和度。
3. **Token 驱动**：颜色 / 圆角 / 阴影走 CSS 变量；改主题只改 token（见 `apps/desktop/src/styles/themes.css`）。
4. **Elevation 分层（v1.1）**：以 surface / card / card-elevated / floating 四级拉开主次——全窗 Surface 底是 chrome（TopBar / Sidebar / RightPanel 外壳），Card 承载常规内容，Card-elevated + 阴影是**唯一主元素**（Composer / 右栏 Context hero），不再用"靠 1px 边线切一切"的网格式表达。
5. **页面内温和阴影**：通过 `--shadow-soft` / `--shadow-strong` / `--shadow-modal` token 控制强度，≤ 200ms 缓动；`contrast` 主题族强制为 `none` 保持硬边。
6. **Pill 优先**：按钮、chip、单行 input、tab 用 `9999px`；容器 12px；多行控件 8px。主题族可覆盖 `--radius-`*。
7. **字重克制**：UI 仅 400 / 500；不用 600+。
8. **图标**：优先 `lucide-react`；状态用色点 / 语义色，不用 emoji。

---



## 一附、主题族（GUI）

偏好字段：`ClientPrefs.themeId` + `ClientPrefs.colorMode`（旧字段 `theme: light|dark` 读入时映射为 `default` + 对应模式；旧 `themeId: cindy` 映射为 `default`）。


| themeId    | 说明             | 样式令牌倾向                                        |
| ---------- | -------------- | --------------------------------------------- |
| `default`  | **默认**；近单色 + 主次分明 | 半径 8/12/16；pill 9999；card-elev + 双层阴影；`--radius-floating: 16px` |
| `nord`     | 冷灰蓝极光          | 半径 10/14/16；阴影同 default；card-elev 跟随冷色调           |
| `tokyo`    | 深蓝夜 + 彩强调      | 半径同 default；focus 光晕更强；`--radius-floating: 18px`    |
| `paper`    | 暖纸 / 墨水        | 半径 10/14/14；**阴影最轻**（`/ 5-6%`）；card-elev 暖色         |
| `contrast` | 高对比选型          | 半径 4/8/**6**；**所有阴影 `none`**；pill 弱化为 8；Board 更硬       |


可变样式令牌：`--radius-control` / `--radius-container` / `--radius-pill`、`--shadow-sm` / `--shadow-md` / `--shadow-lg`、全部颜色 token。字体栈不变。

与 Pi Theme 插件（`~/.pi/agent/themes/*.json`，TUI）无关；互不映射。

组件 / JS **禁止**硬编码色值或圆角；一律走 token。

---



## 二、色彩系统



### 2.1 四层 Surface（v1.1 Elevation 分层）


| 角色              | Light     | Dark      | Token 映射                                                          | 用途                              |
| --------------- | --------- | --------- | ----------------------------------------------------------------- | ------------------------------- |
| **Surface**     | `#f8f8f6` | `#141414` | `--bg-app` / `--bg-sidebar` / `--bg-main`                         | 全窗底；chrome 外壳                 |
| **Card**        | `#ffffff` | `#2c2c2a` | `--bg-header` / `--bg-input` / `--bg-modal`                       | 常规内容（气泡、tool card、settings 弹窗） |
| **Card-elev**   | `#fbfbf7` | `#33332f` | `--bg-card-elev`                                                  | **主元素**底（Composer / 右栏 Context hero） |
| **Chrome**      | `#ededeb` | `#1a1a1a` | `--bg-chrome`                                                     | TopBar / Sidebar / RightPanel 外壳   |
| **Board**       | `#d7d7d4` | `#3c3c3a` | `--border-primary` / `--border-input`                             | 1px 分隔边                        |
| **Chip**        | `#e5e5e5` | `#3c3c3a` | `--bg-list-hover` / `--surface-chip`；选中用略抬升的 `--bg-list-selected` | 次要控件底                          |


主元素 = **Card-elev + 阴影 + 圆角增大**，唯一性由 token + 单一焦点区保证，不再"靠 1px 边线切一切"。其他主题族保持同一四层角色，仅换色值。

### 2.2 文本


| Token                | 深色        | 浅色        | 用途              |
| -------------------- | --------- | --------- | --------------- |
| `--text-primary`     | `#d4d4d4` | `#262626` | 主文本             |
| `--text-secondary`   | `#a3a3a3` | `#525252` | 次要文本            |
| `--text-muted`       | `#737373` | `#737373` | 弱化              |
| `--text-dim`         | `#737373` | `#a3a3a3` | 时间戳等            |
| `--text-placeholder` | `#525252` | `#c4c4c4` | 占位符             |
| `--text-code`        | `#d4d4d4` | `#262626` | 内联代码（灰阶；语法高亮除外） |
| `--text-error`       | `#ff7b72` | `#b31d28` | 错误文本            |




### 2.3 语义色（仅登记用途）


| Token               | 值                      | 用途                      |
| ------------------- | ---------------------- | ----------------------- |
| `--focus-ring`      | `#417CDD`              | 键盘 focus 边框             |
| `--focus-ring-soft` | `rgba(65,124,221,0.5)` | focus 光晕                |
| `--warning-accent`  | `#EA6B17`              | 运行中 / thinking 状态条      |
| `--accent-green`    | `#2AAE5B`              | 空闲 / 成功                 |
| `--accent-red`      | `#D91F37`              | 危险 / 错误                 |
| `--accent-yellow`   | `#F3A115`              | 启动中                     |
| `--accent-blue`     | `#417CDD`              | 仅 focus / 链接；**不作主按钮底** |
| `--accent-gray`     | `#737373`              | 中性                      |


兼容别名：`--accent-purple` 映射到 `--text-secondary`（Cindy；实验主题可给独立色相）。

### 2.3a 上下文组成色（右栏拆解 / 本轮用量条）

低饱和 chart token；默认近单色可区分色相，实验主题可提高饱和度。组件只引用变量，禁止硬编码。


| Token | 用途 |
| --- | --- |
| `--ctx-system` | 系统提示 |
| `--ctx-project` | 项目上下文 |
| `--ctx-skills` | 技能索引 |
| `--ctx-tools` | 工具说明 |
| `--ctx-messages` | 对话消息 |
| `--ctx-overhead` | 协议开销 |
| `--ctx-turn-input` | 本轮 Input |
| `--ctx-turn-output` | 本轮 Output |
| `--ctx-turn-cache` | 本轮 Cache |


### 2.4 按钮与叠层


| Token               | 深色                       | 浅色                 |
| ------------------- | ------------------------ | ------------------ |
| `--btn-bg`          | `#ffffff`                | `#000000`          |
| `--btn-text`        | `#000000`                | `#ffffff`          |
| `--surface-chip`    | `#3c3c3a`                | `#e5e5e5`          |
| `--overlay-bg`      | `rgb(0 0 0 / .45)`       | `rgb(0 0 0 / .35)` |
| `--scrollbar-thumb` | `rgb(255 255 255 / 12%)` | `rgb(0 0 0 / 12%)` |




### 2.5 气泡


| Token               | 说明                         |
| ------------------- | -------------------------- |
| `--bubble-user`     | Chip 底（灰阶，非蓝调）             |
| `--bubble-text`     | Card 抬起                    |
| `--bubble-thinking` | Surface 略暗 + warning 左边线可选 |
| `--bubble-tool`     | Card + Board 边             |
| `--bubble-result`   | `--bg-result`              |




### 2.6 会话状态色


| 状态      | Token              | 脉冲  |
| ------- | ------------------ | --- |
| 启动中     | `--accent-yellow`  | 否   |
| 空闲      | `--accent-green`   | 否   |
| 运行中     | `--warning-accent` | 是   |
| 错误 / 退出 | `--accent-red`     | 否   |


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



## 四、圆角（Cindy 默认四档；主题可覆盖）


| Token                | Cindy  | 用途                                          |
| -------------------- | ------ | ------------------------------------------- |
| `--radius-control`   | 8px    | textarea、气泡、菜单行高亮                           |
| `--radius-container` | 12px   | 卡片、代码块、模态、工具卡                              |
| `--radius-floating`  | 16px   | **主元素**（Composer / 右栏 Context hero）        |
| `--radius-pill`      | 9999px | 按钮、chip、单行 input、tab、nav cell             |


兼容别名：`--radius-sm` / `--radius-md` → control；`--radius-lg` → control（气泡）；`--radius-xl` / `--radius-2xl` → container；`--radius-card` → container（v1.1 alias）。

`contrast` 主题族：`--radius-floating: 6px`（高对比，pill 弱化）。

---



## 五、阴影


| Token             | 用途 / 强度                                   |
| ----------------- | ----------------------------------------- |
| `--shadow-soft`   | 页面内 hover / focus 软阴影；双层 `0 1px 2px / 8%, 0 2px 8px / 6%` |
| `--shadow-strong` | floating 主元素阴影；双层 `0 1px 2px / 8%, 0 8px 24px / 12%` |
| `--shadow-modal`  | settings / confirm 模态浮层；`0 1px 2px / 12%, 0 12px 36px / 18%` |
| `--shadow-sm`     | 旧 alias → `--shadow-soft`（保留兼容）           |
| `--shadow-md`     | 旧 alias → `--shadow-strong`（保留兼容）         |
| `--shadow-lg`     | 旧 alias → `--shadow-modal`（保留兼容）          |


页面内阴影 ≤ 200ms 缓动，强度由 token 控制；`contrast` 主题族强制 `none` 保持硬边。Focus 光晕用 `--focus-ring-soft`，不算装饰阴影。

---



## 六、布局壳层

```
┌─ TopBar（sticky 浮起条；52px；默认 0 阴影，滚动挂载 --shadow-soft）──┐
│  [打开项目] [新会话]    <cwd 路径>           [设置] [更新] [右栏] [主题] │
└────────────────────────────────────────────────────────────┘
↓
[ banners · update · retract / retract confirm ]
↓
┌─ Sidebar ─────┐  ┌─ Chat ──────────────────┐  ┌─ RightPanel ───┐
│  ~260px       │  │  transcript + bubbles    │  │  56px 垂直 nav  │
│  (可折叠到 56) │  │                          │  │  ~360px body    │
│  视觉降权：     │  │                          │  │                 │
│  --bg-chrome  │  │                          │  │                 │
│               │  │  ┌─ Composer ──────────┐ │  │                 │
│               │  │  │ 主元素: card-elev     │ │  │                 │
│               │  │  │ + shadow-strong      │ │  │                 │
│               │  │  │ + radius-floating    │ │  │                 │
│               │  │  └────────────────────┘ │  │                 │
└───────────────┘  └──────────────────────────┘  └─────────────────┘
```

- **TopBar**：sticky 浮起条；背景 `--bg-chrome`；滚动 chat transcript 时挂 `--shadow-soft`；52px 高。
- **Sidebar**：默认 260px；`prefs.sidebarCollapsed: boolean`（默认 false）切换 56px 折叠态；视觉降权为 `--bg-chrome`；group 间距 12px；session card hover 浮起。窄窗（≤960px）强制展开。
- **ChatPanel**：transcript + composer 垂直布局；transcript 与 composer 之间留 `--space-section`（20px）呼吸。
- **Composer**：**唯一主元素**——`--bg-card-elev` + `--shadow-soft`（默认）→ `--shadow-strong`（focus-within） + `--radius-floating`（16-18px） + 上下 16-20px 呼吸；模式色边仅在 streaming 状态加挂。
- **RightPanel**：head 简化为关闭按钮；56px 左侧垂直 nav（图标 + tooltip 文字），选中态加 2px mode 色条 + `--bg-card` 底；Context tab 的 hero 区单独提为 `--bg-card-elev` + `--radius-floating` + `--shadow-soft` 主卡；其余 sections 退到 `--bg-card` 底，section 间 12px 间距不再用 1px 横线。
- **Settings**：居中模态（非全屏路由）；几何与主壳层一致（`--radius-floating`）；左侧 nav 用 pill 选中态（通用 / 供应商 / 用量 / 工具 / 插件 / Godot）。
- **右栏**：`ClientPrefs.rightPanelOpen`；窄窗（≤960px）隐藏右栏。
  - **上下文**：占用进度（hero 主卡）、组成拆解、本轮 / 会话用量；手动压缩
  - **计划**：Markdown 编辑、todos 勾选、保存到项目、执行计划
  - **工具**：已启用工具分组与调用详情
  - **文件**：项目文件树、预览、右键（加入对话 / 资源管理器 / 复制路径）
  - **Godot**：RPC 桥接状态、Ping（完整控制面在设置 → Godot → 编辑器连接）
- Goal 条：轮次预算 / 暂停·继续 / 清除（见会话模式）。

---



## 七、通用组件约定



### 7.1 按钮


| 类型        | 样式                                | 用途        |
| --------- | --------------------------------- | --------- |
| Primary   | `--surface-chip` pill             | 常见主操作     |
| CTA       | `--btn-bg` / `--btn-text` 反相 pill | 最高强调（发送等） |
| Secondary | Card + Board 边 pill               | 次要        |
| Danger    | `--accent-red` pill               | 删除 / 中止   |
| Ghost     | 透明 pill                           | 工具栏轻操作    |


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
3. 页面内 `box-shadow` 必须走 `--shadow-soft` / `--shadow-strong` / `--shadow-modal` token；硬编码 shadow 值或 `0 1px 1px` 这类临时值都属反模式（`contrast` 主题族强制 `none`）。
4. 任意硬编码圆角（须用 `--radius-*`）或蓝实心主按钮铺满工具栏。
5. 字重 ≥600。
6. 渐变背景装饰。
7. 多个元素同时抢"主元素"视觉焦点——主元素只有一个：Composer + 当前的 RightPanel hero。其它区域保持低调 chrome。

