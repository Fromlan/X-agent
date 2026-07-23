# X-agent 设计系统

> 核心视觉：OKLCH 色彩、深色默认的双主题、Inter + Geist Mono、细边框与柔和阴影、token 驱动。组件不写死颜色，一律引用 CSS 变量。

---

## 一、设计原则

1. **深色优先**：`:root` 为深色；`body[data-theme="light"]` 覆盖为浅色。
2. **OKLCH 色彩**：颜色用 `oklch(L C H)`，感知均匀；深浅主题主要调 L。
3. **Token 驱动**：颜色 / 圆角 / 阴影走 CSS 变量；改主题只改 token。
4. **克制的层次**：背景分层 + `0.5px` 细边框 + 三级阴影，不用重描边。
5. **紧凑密度**：正文约 13px、内边距 6–12px，开发工具风格。
6. **相对色派生**：hover / focus / active 用 `oklch(from var(--x) l c h / α)`，不另设一套色。
7. **图标**：优先矢量图标（如 lucide）；状态用色点 / 语义色，不用 emoji。

---

## 二、色彩系统（OKLCH）

### 2.1 背景分层

| Token | 深色 | 浅色 | 用途 |
|---|---|---|---|
| `--bg-app` | `oklch(.155 .005 285.8)` | `oklch(.964 .001 286.4)` | 应用底层 |
| `--bg-sidebar` | `oklch(.155 .005 285.8)` | `oklch(.964 .001 286.4)` | 侧栏 |
| `--bg-main` | `oklch(.18 .005 285.8)` | `oklch(.988 0 0)` | 主内容区 |
| `--bg-header` | `oklch(.21 .006 285.9)` | `oklch(1 0 0)` | 顶栏 / 卡片头 |
| `--bg-input` | `oklch(.235 .007 285.9)` | `oklch(1 0 0)` | 输入框 / 次级按钮 |
| `--bg-modal` | `oklch(.235 .007 285.9)` | `oklch(1 0 0)` | 弹窗 |
| `--bg-list-hover` | `oklch(.274 .006 286)` | `oklch(.967 .001 286.4)` | 列表悬停 |
| `--bg-list-selected` | `oklch(.3 .006 286)` | `oklch(.95 .002 286.4)` | 列表选中 |
| `--bg-result` | `oklch(.13 .005 285.8)` | `oklch(.95 .002 286)` | 工具结果背景 |

### 2.2 文本

| Token | 深色 | 浅色 | 用途 |
|---|---|---|---|
| `--text-primary` | `oklch(.985 0 0)` | `oklch(.155 .005 286)` | 主文本 |
| `--text-secondary` | `oklch(.75 .005 286)` | `oklch(.42 .01 286)` | 次要文本 |
| `--text-muted` | `oklch(.62 .01 286)` | `oklch(.55 .01 286)` | 弱化 / 占位 |
| `--text-dim` | `oklch(.68 .01 286)` | `oklch(.48 .01 286)` | 时间戳等极弱文本 |
| `--text-code` | `oklch(.72 .13 255)` | `oklch(.45 .16 255)` | 内联代码 |
| `--text-error` | `oklch(.78 .16 22)` | `oklch(.5 .2 27)` | 错误文本 |

### 2.3 强调色（Accent）

| Token | 深色 | 浅色 | 语义 |
|---|---|---|---|
| `--accent-blue` | `oklch(.65 .16 255)` | `oklch(.55 .16 255)` | 主色 / 链接 / 运行中 / focus |
| `--accent-green` | `oklch(.65 .15 145)` | `oklch(.55 .16 145)` | 成功 / 空闲 |
| `--accent-red` | `oklch(.704 .191 22)` | `oklch(.577 .245 27)` | 危险 / 错误 |
| `--accent-yellow` | `oklch(.75 .16 85)` | 同 | 警告 / 启动中 |
| `--accent-purple` | `oklch(.6 .16 300)` | `oklch(.5 .18 300)` | 次强调（如压缩中） |
| `--accent-gray` | `oklch(.62 .01 286)` | `oklch(.55 .01 286)` | 中性 |

### 2.4 边框与按钮

| Token | 深色 | 浅色 |
|---|---|---|
| `--border-primary` | `oklch(1 0 0 / 10%)` | `oklch(.92 .004 286)` |
| `--border-input` | `oklch(1 0 0 / 14%)` | `oklch(.88 .005 286)` |
| `--border-focus` | `oklch(.65 .16 255)` | `oklch(.55 .16 255)` |
| `--btn-bg` | `var(--accent-blue)` | `var(--accent-blue)` |
| `--btn-text` | `oklch(1 0 0)` | `oklch(1 0 0)` |
| `--overlay-bg` | `rgb(0 0 0 / .55)` | `rgb(15 23 42 / .35)` |
| `--scrollbar-thumb` | `oklch(1 0 0 / 10%)` | `oklch(0 0 0 / 12%)` |

### 2.5 气泡背景（建议）

| Token | 说明 |
|---|---|
| `--bubble-user` | 用户气泡（蓝调，可从 `--accent-blue` 低透明度派生） |
| `--bubble-text` | 助手气泡 |
| `--bubble-thinking` | 思考块 |
| `--bubble-tool` | 工具调用 |
| `--bubble-result` | 工具结果 |

### 2.6 会话状态色

| 状态 | Token | 脉冲 |
|---|---|---|
| 启动中 | `--accent-yellow` | 否 |
| 空闲 | `--accent-green` | 否 |
| 运行中 | `--accent-blue` | 是 |
| 错误 / 退出 | `--accent-red` | 否 |

颜色由 CSS 类绑定 token，禁止在 JS 中写死色值。

---

## 三、字体

```css
--font-sans: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI",
             "PingFang SC", "Hiragino Sans", "Microsoft YaHei", sans-serif;
--font-mono: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, Consolas,
             "Courier New", monospace;
```

- 正文：Inter（400/500/600/700），含中文回退。
- 等宽：Geist Mono，用于代码、工具参数、数字对齐。
- 全局建议：`font-size: 13px; line-height: 1.5`。
- 输入框等主动输入区可用 `14px`。
- 数字对齐：`font-family: var(--font-mono); font-variant-numeric: tabular-nums`。

---

## 四、圆角

| Token | 值 | 用途 |
|---|---|---|
| `--radius-sm` | 6px | 小按钮、角标 |
| `--radius-md` | 8px | 输入框、按钮、工具卡 |
| `--radius-lg` | 10px | 消息气泡 |
| `--radius-xl` | 14px | 弹窗 |
| `--radius-2xl` | 18px | 大卡片（预留） |

---

## 五、阴影

| Token | 深色 | 浅色 |
|---|---|---|
| `--shadow-sm` | `0 1px 2px rgb(0 0 0 / .24), 0 1px 1px rgb(0 0 0 / .18)` | `0 1px 2px rgb(15 23 42 / .05)` |
| `--shadow-md` | `0 8px 24px rgb(0 0 0 / .32), 0 2px 6px rgb(0 0 0 / .18)` | `0 8px 24px rgb(15 23 42 / .1)` |
| `--shadow-lg` | `0 16px 40px rgb(0 0 0 / .46), 0 3px 10px rgb(0 0 0 / .24)` | `0 16px 40px rgb(15 23 42 / .16)` |

侧栏与顶栏优先用边框分区，少用阴影；弹窗用 `--shadow-lg`。

---

## 六、相对色派生

```css
/* focus 光晕 */
:focus-visible {
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px oklch(from var(--accent-blue) l c h / 0.18);
}

/* 危险 hover */
.danger:hover {
  color: var(--accent-red);
  background: oklch(from var(--accent-red) l c h / 0.12);
}
```

语法：`oklch(from <token> l c h / <alpha>)`，通道写 `l c h` 表示保留原值。

---

## 七、通用组件约定

### 7.1 按钮

| 类型 | 背景 | 文字 | 用途 |
|---|---|---|---|
| Primary | `--btn-bg` | `--btn-text` | 主操作 |
| Secondary | `--bg-input` + `--border-input` | `--text-primary` | 次要操作 |
| Danger | `--accent-red` | 白 | 删除 / 中止 |
| Ghost | 透明 | `--text-secondary` | 工具栏轻操作 |

统一：`border-radius: var(--radius-md)`；padding 约 `8px 16px`；`font-size: 13px`；过渡约 `0.12s`。

### 7.2 消息气泡

- 基类：圆角 `--radius-lg`，padding 约 `10px 14px`，字号 13px，行高 1.6，最大宽度约 82%。
- 用户：右对齐，蓝调背景。
- 助手：左对齐。
- 思考：可折叠，弱化样式。
- 工具 / 结果：左侧 `3px` accent 条（蓝 / 绿；错误用红）。

### 7.3 弹窗与滚动条

- 遮罩：`--overlay-bg`，可加轻微 `backdrop-filter`。
- 弹窗：`--bg-modal` + `0.5px --border-primary` + `--radius-xl` + `--shadow-lg`。
- 滚动条：约 10px，thumb 用 `--scrollbar-thumb`。

---

## 八、动效

- 尊重 `prefers-reduced-motion: reduce`。
- 运行中状态点：`pulse` 约 1.2s。
- 流式光标：轻量 `blink`。
- 交互过渡统一约 `0.12s`（background / border-color / color / opacity）。

---

## 九、反模式（禁止）

1. 组件内硬编码颜色（如 `#e8c33d`）→ 用 token 或 `oklch(from …)`。
2. 用 emoji 当 UI 图标。
3. 大面积 inline `style` 上色 → 用语义类 + token。
4. 新元素用 1px 实色粗边框 → 用 `0.5px` + 半透明边框 token。
5. 用 `outline` 做焦点环 → 用 `box-shadow` + accent 派生光晕。
