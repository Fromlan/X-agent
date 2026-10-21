# X-agent 设计系统

---

## 一、设计原则

1. **深色优先**：`:root` 为深色回退；`body[data-theme="{themeId}-{colorMode}"]` 覆盖完整 token。
2. **石墨工作台**：默认冷中性灰阶；主题族统一灰阶色温，强调色用于选中、focus、链接和状态，避免整片高饱和底色。
3. **Token 驱动**：颜色 / 圆角 / 阴影走 CSS 变量；改主题只改 token（见 `apps/desktop/src/styles/themes.css`）。
4. **Elevation 分层**：外壳和侧栏较深，对话画布略亮；工具记录与浮层使用 Card，输入区使用 Card-elevated + 阴影。助手正文直接排在画布上，阴影集中于 Composer、菜单与弹窗。
5. **页面内温和阴影**：通过 `--shadow-soft` / `--shadow-strong` / `--shadow-modal` token 控制强度，≤ 200ms 缓动；`contrast` 主题族强制为 `none` 保持硬边。
6. **Pill 优先**：按钮、chip、单行 input、tab 用 `9999px`；容器 12px；多行控件 8px。主题族可覆盖 `--radius-`*。
7. **字重克制**：UI 仅 400 / 500；不用 600+。
8. **图标**：优先 `lucide-react`；状态用色点 / 语义色，不用 emoji。

---

## 一附、主题族（GUI）

偏好字段：`ClientPrefs.themeId` + `ClientPrefs.colorMode`（旧字段 `theme: light|dark` 读入时映射为 `default` + 对应模式；旧 `themeId: cindy` 映射为 `default`）。

| themeId    | 说明             | 样式令牌倾向                                        |
| ---------- | -------------- | --------------------------------------------- |
| `default`  | **石墨**；默认，冷中性灰 | 深石墨 / 冷白；雾银强调，突出对话与输入区层次 |
| `nord`     | **雾蓝** | 深海蓝灰 / 冰白；低饱和蓝色选中态 |
| `tokyo`    | **暮紫** | 深梅灰 / 雾粉白；柔和灰紫强调 |
| `paper`    | **暖砂** | 暖墨 / 象牙纸；棕金强调与暖色阴影 |
| `sage`     | **松绿** | 松针绿 / 淡绿白；鼠尾草色强调 |
| `contrast` | 高对比选型          | 半径 4/8/**6**；**所有阴影 `none`**；pill 弱化为 8；Board 更硬       |

可变样式令牌：`--radius-control` / `--radius-container` / `--radius-pill`、`--shadow-sm` / `--shadow-md` / `--shadow-lg`、全部颜色 token。字体栈不变。

五套常规主题均使用半径 8/12/16、pill 9999，保持工作台几何一致。每套支持独立深浅模式；旧主题 ID 保留，现有偏好自动使用更新后的配色。

设置 → 通用顶部通过缩略工作台卡片选择主题，模式单独切换。预览以 `data-theme-preview` 复用同一份 token，语义别名在预览节点局部解析。保存成功后更新选中态，失败保留原主题并提示；支持键盘 Tab / Enter。主文本、次要文本、选中项、输入占位与主按钮的文字对比均至少 4.5:1。

与 Pi Theme 插件（`~/.pi/agent/themes/*.json`，TUI）无关；互不映射。

组件 / JS **禁止**硬编码色值或圆角；一律走 token。

---

## 二、色彩系统

### 2.1 四层 Surface（v1.1 Elevation 分层）

| 角色              | Light     | Dark      | Token 映射                                                          | 用途                              |
| --------------- | --------- | --------- | ----------------------------------------------------------------- | ------------------------------- |
| **Surface**     | `#f3f4f7` | `#111316` | `--bg-app`                         | 全窗底；对话画布与侧栏另分层 |
| **Card**        | `#f7f8fb` | `#202329` | `--bg-header` / `--bg-modal` / `--bg-card`                       | 常规内容（工具记录、弹窗） |
| **Card-elev**   | `#ffffff` | `#282c33` | `--bg-card-elev`                                                  | **主元素**底（Composer） |
| **Chrome**      | `#e9edf3` | `#14161a` | `--bg-chrome`                                                     | TopBar 外壳；侧栏使用独立层级 |
| **Board**       | `#d7dce6` | `#343944` | `--border-primary`                             | 1px 分隔边 |
| **Chip**        | `#e8edf5` | `#2b3038` | `--surface-chip`；选中用略抬升的 `--bg-list-selected` | 次要控件底 |

默认深色对话画布为 `#1c1e23`，侧栏为 `#16181c`，输入控件为 `#25282e`，输入边框为 `#424a58`。语义别名在当前 body / 预览主题边界解析，明暗切换时不继承默认深色的计算结果。

主元素 = **Card-elev + 阴影 + 圆角增大**，唯一性由 token + 单一焦点区保证，不再"靠 1px 边线切一切"。其他主题族保持同一四层角色，仅换色值。

### 2.2 文本

| Token                | 深色        | 浅色        | 用途              |
| -------------------- | --------- | --------- | --------------- |
| `--text-primary`     | `#e8eaf0` | `#252c39` | 主文本             |
| `--text-secondary`   | `#b2b8c5` | `#505b6d` | 次要文本            |
| `--text-muted`       | `#9098a8` | `#626e80` | 弱化              |
| `--text-dim`         | `#9098a8` | `#626e80` | 时间戳等            |
| `--text-placeholder` | `#9ba3b2` | `#626e80` | 占位符             |
| `--text-code`        | `#e8eaf0` | `#252c39` | 内联代码（灰阶；语法高亮除外） |
| `--text-error`       | `#efa9a3` | `#ac4548` | 错误文本            |

### 2.3 语义色（仅登记用途）

| Token               | 默认深色值               | 用途                      |
| ------------------- | ---------------------- | ----------------------- |
| `--focus-ring`      | `#b4c9eb`              | 键盘 focus、选中边框与页签标记 |
| `--focus-ring-soft` | focus 色 22% 透明混合 | focus 光晕                |
| `--warning-accent`  | `#d9bb89`              | 运行中 / thinking 状态条      |
| `--accent-green`    | `#9bceb1`              | 空闲 / 成功                 |
| `--accent-red`      | `#efa9a3`              | 危险 / 错误                 |
| `--accent-yellow`   | `#d9bb89`              | 启动中                     |
| `--accent-blue`     | `#b4c9eb`              | focus / 链接；**不作主按钮底** |
| `--accent-gray`     | `#9098a8`              | 中性                      |

`--accent-purple` 默认使用灰紫色 `#b7acd1`，用于计划模式和图表语义。

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
| `--btn-bg`          | `#e2e8f2`                | `#293a56`          |
| `--btn-text`        | `#1b2331`                | `#ffffff`          |
| `--surface-chip`    | `#2b3038`                | `#e8edf5`          |
| `--overlay-bg`      | `rgb(8 11 17 / 62%)`     | `rgb(34 45 62 / 28%)` |
| `--scrollbar-thumb` | `rgb(215 225 240 / 16%)` | `rgb(44 56 72 / 18%)` |

### 2.5 气泡

| Token               | 说明                         |
| ------------------- | -------------------------- |
| `--bubble-user`     | 随主题色温调整的低饱和底色             |
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
- 全局：`font-size: 14px; line-height: 1.5`；助手正文 15px，Markdown 行高 1.8；输入文字 15px，侧栏历史会话标题 14px。
- 数字对齐：`font-family: var(--font-mono); font-variant-numeric: tabular-nums`。

---

## 四、圆角（default 默认四档；主题可覆盖）

| Token                | default  | 用途                                          |
| -------------------- | ------ | ------------------------------------------- |
| `--radius-control`   | 8px    | textarea、气泡、菜单行高亮                           |
| `--radius-container` | 12px   | 卡片、代码块、模态、工具卡                              |
| `--radius-floating`  | 16px   | **主元素**（Composer）        |
| `--radius-pill`      | 9999px | 按钮、chip、单行 input、tab、nav cell             |

兼容别名：`--radius-sm` / `--radius-md` → control；`--radius-lg` → control（气泡）；`--radius-xl` / `--radius-2xl` → container；`--radius-card` → container（v1.1 alias）。

`contrast` 主题族：`--radius-floating: 6px`（高对比，pill 弱化）。

---

## 五、阴影

| Token             | 用途 / 强度                                   |
| ----------------- | ----------------------------------------- |
| `--shadow-soft`   | 主题色温的轻阴影；石墨深色为 `0 2px 8px / 12%`，浅色 4% |
| `--shadow-strong` | 输入区 focus 阴影；石墨深色为 `0 2px 4px / 16%, 0 12px 32px / 20%`，浅色 4% / 7% |
| `--shadow-modal`  | settings / confirm 浮层；石墨深色为 `0 4px 12px / 20%, 0 24px 72px / 36%`，浅色 6% / 16% |
| `--shadow-sm`     | 旧 token，默认主题为 `none`；以主题定义为准       |
| `--shadow-md`     | 旧 token，默认主题为 `none`；以主题定义为准       |
| `--shadow-lg`     | 旧模态阴影 token，当前映射到 `--shadow-modal` |

页面内阴影 ≤ 200ms 缓动，强度由 token 控制；`contrast` 主题族强制 `none` 保持硬边。Focus 光晕用 `--focus-ring-soft`，不算装饰阴影。

---

## 六、布局壳层

```
┌─ TopBar（原生无框窗口内的单一标题栏；48px；可拖动）──┐
│  [X-agent 品牌]                              [最小化] [最大化] [关闭] │
└────────────────────────────────────────────────────────────┘
↓
[ banners · update · retract / retract confirm ]
↓
┌─ Sidebar ─────┐  ┌─ Chat ──────────────────┐  ┌─ RightPanel ───┐
│  ~260px       │  │  header + transcript     │  │  顶部五个页签   │
│  (可折叠到 56) │  │                          │  │  ~360px body    │
│  视觉降权：     │  │                          │  │                 │
│  --bg-sidebar │  │                          │  │                 │
│               │  │  ┌─ Composer ──────────┐ │  │                 │
│               │  │  │ 主元素: card-elev     │ │  │                 │
│               │  │  │ + shadow-strong      │ │  │                 │
│               │  │  │ + radius-floating    │ │  │                 │
│               │  │  └────────────────────┘ │  │                 │
└───────────────┘  └──────────────────────────┘  └─────────────────┘
```

- **TopBar**：仅品牌、拖动区域及最小化 / 最大化还原 / 关闭按钮；高度 48px，背景 `--bg-chrome`。窗口操作经 workspace IPC 的统一 sender 校验；保留原生调整尺寸和关闭生命周期。
- **Sidebar**：顶部为项目切换器、Godot 项目标识、打开项目 / 新会话 / 项目设置；代码 / 策划切换仅筛选当前项目历史，新会话根据当前筛选创建。会话按今天 / 昨天 / 更早分组，项目管理保留右键入口，底部固定设置和权威版本号。默认 260px；`prefs.sidebarCollapsed: boolean`（默认 false）切换 56px 折叠态；背景 `--bg-sidebar`；当前会话以底色和窄竖线标记。窄窗（≤960px）强制展开。
- **ChatPanel**：header + transcript + composer 垂直布局；header 显示会话标题、项目和代码 / 策划类型。Godot 项目只有当前项目的编辑器通过鉴权才显示已连接。右侧的工作区选项菜单保留主题、更新、会话栏和工具面板开关。
- **Composer**：主要交互焦点，使用 `--bg-card-elev`、主题阴影和 `--radius-floating`；附件、模式、模型、Thinking、展示思考与发送集中于工具栏。四种模式收纳为支持键盘的下拉菜单，继续支持 Shift+Tab；快捷键提示位于输入行右侧，请求中显示阶段状态。自身列宽不超过 520px 时模型组另起一行，模式与发送保持可达。
- **RightPanel**：顶部五个带文字的页签，选中项以下划线标记，关闭按钮位于右上；内容区独立滚动。上下文摘要使用常规 Card，计划页显示已完成步骤数、真实上下文用量及当前项目 Godot 连接摘要；完整文档默认收纳，避免与可勾选步骤重复展示，仍支持展开和源码编辑。
- **Settings**：在顶栏下方的工作区内居中（非全屏路由），使用 `--titlebar-height` 避开原生拖动区，并以剩余高度限制弹窗；四周保留 `--dialog-gutter`，标题与关闭按钮固定可见。几何与主壳层一致（`--radius-floating`）；左侧 nav 用 pill 选中态（通用 / 供应商 / 用量 / 工具 / 插件 / Godot）。
- **界面文案**：保留字段标签、简短空状态、操作结果与错误提示；不常驻展示教程、协议细节、配置文件路径、调试介绍或重复的状态说明。
- **应用标识**：统一使用内置图标与 favicon；不提供品牌 Logo 切换或自定义上传。
- **右栏**：`ClientPrefs.rightPanelOpen`；窄窗（≤1100px）右栏覆盖聊天区域显示。
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
- 助手：左对齐、透明画布，X-agent 标签与段落间距建立层级；错误态保留语义提示。
- 单个工具卡：`--radius-container` + 左边语义条；批次使用低对比边框与紧凑记录行，保留展开和状态图标，默认折叠及完成时自动收纳行为不变。

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

### Windows 小屏与缩放

Windows 窗口尺寸按 Electron DIP 工作区限制：初始目标 1280×840，最小目标 900×600，均不得超过可用区域；跨显示器时重新约束。宽度不超过 1100px 时右栏覆盖显示，保留聊天宽度。设置内容区保持 `min-height: 0` 和 `overflow-y: auto`，确保 100%、125%、150% 缩放下模式、输入和关键按钮可操作，不通过缩小字体适配。

## 九、反模式（禁止）

1. 组件内硬编码颜色 → 用 token。
2. 用 emoji 当 UI 图标。
3. 页面内 `box-shadow` 必须走 `--shadow-soft` / `--shadow-strong` / `--shadow-modal` token；硬编码 shadow 值或 `0 1px 1px` 这类临时值都属反模式（`contrast` 主题族强制 `none`）。
4. 任意硬编码圆角（须用 `--radius-*`）或蓝实心主按钮铺满工具栏。
5. 字重 ≥600。
6. 渐变背景装饰。
7. 多个元素同时抢视觉焦点——主要交互焦点是 Composer，右栏占用摘要使用常规 Card，其它区域保持低调。

