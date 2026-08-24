# Changelog

本文件记录 X-agent 面向用户的重要变更。版本号以 [`apps/desktop/package.json`](apps/desktop/package.json) 为准。

发版前须把下方 `Unreleased` 整理进对应 `## x.y.z` 章节；GitHub Release 正文由该章节生成（见 `scripts/prepare-release.mjs`）。

升 **minor 线起点**（如 `0.3.0`，patch 为 0 且 minor > 0）时，`prepare-release` 会把上一线全部小版本（`0.2.0`…`0.2.x`）汇总写入本章节；GitHub Release 正文使用该章节（已含汇总则不再重复附加）。补丁版（如 `0.3.1`）不汇总。可用 `npm run release:notes -- 0.3.0` 预览，`--no-aggregate` 关闭自动附加。

## Unreleased

### 改进

- **UI 主次分明与简洁直观改版（v1.1 设计语言落地）**：原"全窗单 Surface + 1px Board 切边 + 页面内 0 阴影"的扁平网格感，改为 elevation 驱动的层级式布局——Composer / 输入区作为整窗唯一主元素（`--bg-card-elev` + `--shadow-strong` + `--radius-floating` 双层阴影 + 16-20px 圆角 + 上下 16-20px 呼吸区），三栏壳层（TopBar / Sidebar / RightPanel）降为低调 chrome（统一 `--bg-chrome` 底）。
  - **新增 5 个 elevation token + 2 个 spacing token**（`apps/desktop/src/styles/themes.css` + `app.css`）：`--bg-card-elev` / `--bg-chrome` / `--shadow-soft` / `--shadow-strong` / `--shadow-modal` / `--radius-floating` / `--space-section` / `--space-chrome`。`--shadow-sm/md/lg` 保留为 alias 指向新 token，向后兼容。10 个主题族（default / nord / tokyo / paper / contrast × dark/light）全部补齐；`contrast` 强制 `none` 保持硬边，`paper` 走最轻一档。
  - **TopBar 浮起条**：高度 48→52px，背景 `--bg-app` → `--bg-chrome`，新增 `useScrollElevated` hook 监听 chat transcript 滚动状态，滚动时挂 `--shadow-soft`（默认 0 阴影避免常驻压感）；"打开项目"按钮提为 `btn-cta`（最高强调），其余按钮保留 ghost。
  - **Sidebar 可折叠**：`prefs.sidebarCollapsed: boolean`（默认 false）持久化；新增 `useNarrowWindow` hook，窗口 ≤960px 时自动展开避免无入口。折叠态 56px 宽，仅显示项目首字母圆形 avatar + count badge（点击切到该项目最近会话）；展开态 group 间距从 4px 拉大到 12px，呼吸感更强；背景 `--bg-sidebar` → `--bg-chrome`。
  - **RightPanel 垂直 nav + Context hero 提级**：水平 5 tabs → 左侧 56px 垂直 nav（`--accent-blue` 左侧 2px 高亮条 + 选中态 `--bg-card` 底），删除"工具面板"标题与头部；Context tab 的 `rp-context-hero` 单独提为主卡（`--bg-card-elev` + `--radius-floating` + `--shadow-soft`），其余 sections 退到普通 card 底，section 间 1px 横线删除改 4px gap。
  - **Composer 升级为唯一主元素**：圆角 12px → 16-18px，背景 `--bg-input` → `--bg-card-elev`，去掉 1px color-mix mode 边线（阴影 + 提色已够强），默认 `--shadow-soft` / focus-within & streaming 升级到 `--shadow-strong`，外层 padding 12/14/14 → 18/14/16。Mode pill active 态加 1.5px inset 模式色边 + 字重 500，与 Composer 同步主次。
  - **Chat transcript 间距 + 工具卡提级**：行间距 16px → 20px（ROW_GAP_PX + .message-stream-inner gap）；展开态 tool card / tool batch 加 `--shadow-soft` + `--bg-card` 底，折叠态 pill 模式保留原视觉不抢戏。
  - **设置弹窗几何同步**：`.modal-panel` 圆角 12px → 16-18px，阴影 `--shadow-lg` → `--shadow-modal`，与主卡保持一致"主焦点"语义。
  - **DESIGN.md 改稿**：§一.4 扁平分层 → elevation 分层；§五 0 阴影 → token 控制；§六 布局壳层 ASCII 图重画；§九 加 §九.7 主元素唯一性反模式；§一附主题族表更新。
- **仓库健康流程落地（社区化与流程自动化）**：补齐开源项目健康流程所需文件——`LICENSE` (MIT)、`CONTRIBUTING.md`、`CODE_OF_CONDUCT.md` (Contributor Covenant v2.1)、`SECURITY.md`、`MAINTENANCE.md`；`.github/CODEOWNERS` 锁定路径 owner；`.github/dependabot.yml` 启用 npm + GitHub Actions 周更；`.github/ISSUE_TEMPLATE/` 三个 YAML（bug / feature / question）+ `.github/PULL_REQUEST_TEMPLATE.md` + `.github/labels.yml`（19 个标签）；commit-msg 钩 `scripts/commit-msg-lint.mjs`（17 个 case 配套测试）锁 Conventional Commits 格式；CI `actionlint` job 校验 workflow YAML；`prepare-release.mjs` 加 tag 漂移硬闸（package.json > 最新 tag 时拒绝；支持 `--force`）；`release.yml` checkout `fetch-depth: 0`；根 / `apps/desktop` / `packages/godot-pi` 的 `package.json` 补 `license` / `author` / `repository` / `bugs` / `engines`；README 中英加「反馈与贡献」小节，CLAUDE / ROADMAP 加对 `MAINTENANCE.md` 的引用。

### 移除

- **游戏开发四阶段工作流（策划 / 原型 / 测试 / 扩充）**：2026-08-23 引入的 4 阶段项目级工作流（含顶栏阶段进度条、阶段切换 modal、阶段专属右栏 tab、`<cwd>/.x-agent/stage.json` 持久化、`StageController`、阶段化 skill 过滤层）整体回滚。该功能仍在实验、没在实际项目里跑通完整流程，与核心 4 mode（agent / ask / plan / goal）解耦不彻底。现回到 4 模式独享工作流的设计。如有用户本机上的 `<cwd>/.x-agent/stage.json` 与 `.x-agent/{design,prototype,test,expand}/` 产物目录残留可手工删除，不会被自动清理。

### 修复

- **一键安装本地 Packages 不再被静默删除**：pi CLI 会把本地包路径按 `~/.pi/agent` 相对化写入 `settings.json`（如 `..\..\AppData\...\resources\godot-pi`），而 X-agent 此前按进程 cwd 解析相对路径，导致安装记录被判为"包源缺失"，被 `pruneMissingPiPackageSources` 从 `settings.json` 与 `x-agent-packages.json` 一并清除（表现为"安装成功"提示后「技能 / 提示词 / 扩展」页签为空）。现包源解析统一以 `~/.pi/agent` 为基准（与 pi CLI 一致），相对路径正常解析，prune / 去重 / registry 镜像均保留安装记录。

## 0.5.3

### 改进

- **Diff 显示**：Agent 每回合结束（Shadow 检查点可用时）在回复下方折叠展示本轮改动的高亮 diff（`+/-` 行着色、文件数与增删统计（`+N` 绿 / `-N` 红）、超长截断）；撤回确认弹窗新增「将被还原的内容」diff 预览（`pre→HEAD` 统一 diff），与「涉及文件」列表并列，撤回前可逐行确认影响范围。
- **Diff 显示（无 Git 降级）**：本机未安装 Git 时不再完全缺失 diff——基于 `write` / `edit` 工具执行前记录的字节基线，与当前文件内容对比（jsdiff）生成同样的高亮 diff；回合 diff 与撤回预览「write/edit 改动预览（无 Git 降级）」均可用。bash 改盘等无基线的改动仍无法追踪（与"无法还原"的降级语义一致）。
- **Clarify 问答每题支持自行输入答案**：Plan 模式 AI 追问（`<clarify>` 多选块）每题新增「自行输入答案」选项——点选展开输入框填写自由文本，与选项互斥（选选项会清掉自定义、开自定义会取消选项）；已填文本计入作答进度，提交时自定义答案与选项同格式（`问题 → 答案`）发送给模型。

### 安全（项目整体审查后修复）

- **Godot 项目设置硬闸**：`godot_set_project_setting` 经 `shared/godot-project-setting.ts` 校验——敏感前缀（`autoload/*` / `input/*` / `debug/file_logging/*` / `debug/shapes/*` / `project_settings_override/*` / `editor_plugins/enabled` / `network/tls/certificate_bundle_override` 等）拒绝写入；value 收窄为 string / number / boolean 或简单嵌套（最多 1 层）；key 限 ASCII 字母数字+`/_`，避免 `project.godot` 注入。
- **Provider baseUrl DNS 闸**：保存供应商档案时 `upsertProviderProfile` 经 `validateUpsertAsync` 双重校验（静态 host 黑名单 + 异步 DNS rebinding 解析），拒绝私网 / `localtest.me` / `*.nip.io` 等。
- **Godot RPC 客户端与项目绑定**：`GodotRpcBridge` 新增 `setCurrentCwd`——已绑定时仅当前会话项目下的客户端合法；显式 `clientId` 与 cwd 不匹配直接拒绝（不静默改道）；切换项目时若原 active 不匹配则重置为首个匹配客户端。
- **shellPath 真 Bash 闸**：`applyBashShellPath` 要求 `--version` 输出包含 GNU bash 特征；非可信目录会同时返回 `warning`，由 renderer 横幅提示。
- **Godot 资源清理**：RPC 启动期 `server.unref()`、`stop()` 强制 1s 超时降级；编辑器子进程 spawn 失败路径也 `unref()`；auto-updater 启动检查 `unref()`。
- **持久化原子化**：`plan-journal` / `goal-journal` 改走 `atomic-write.ts` 的 `writeJsonAtomicSync`（tmp + rename），不再写半截；`package-manager` registry 同步入口加 per-key 自旋锁，避免 install / prune 并发互相覆盖。
- **启动失败摘要**：recover / bridge / package install 失败写入 `getStartupReport` 通道并 dbgLog，renderer 经 ReadyChecklist 提示用户。
- **abort 失败状态修正**：abort 抛错时不再盲目 `setStatus('idle')`——重读 `isStreaming`，仍 streaming 时保留 `error` 状态并 emit notice。
- **usage 写入失败**：error-bridge 内 catch 改为 dbgWarn，便于诊断。
- **orphan 清理**：启动期清理残留 `.tmp` / bash-liveness probe / 90 天未用的 godot-rpc endpoint。

### 测试 & 质量

- **Vitest 覆盖扩展**：新增 `bash-readonly` / `external-url` / `secret-codec` / `atomic-write` / `provider-persist` 五套 vitest 单元测试（与 `godot-project-setting` / `godot-rpc-bridge` 合计 24 套 323 测试 92% 覆盖率）；新增 `setSkipDnsForTests` / `setSkipPiSyncForTests` 用于隔离外部依赖。
- **E2E 契约扩展**：从 2 个扩到 6 个（`contracts` / `mode-flow` / `mode-attestation` / `ipc-validation` / `startup-report`）——锁定 facade 行为、IPC 校验、状态机契约。
- **CI 加固**：新增 `concurrency` 与 `lint` 步骤；`e2e` job 加 Playwright 浏览器缓存；`release` workflow 加 `lint` 与 `test-extract-changelog` 校验。

## 0.5.2

### 修复（Godot 工具 · 插件 0.6.3）

- **`godot_list_project_files` 恒超时根因修复**：请求携带 `type` 过滤参数，插件 `_handle_line` 用 `data.has("type")` 区分请求/事件时被误判为事件直接丢弃（1.3 引入 `type` 参数以来一直如此——表现为任意参数组合恒 timeout、无 SCRIPT ERROR、其余 16 个工具正常）。判定改为以 `method` 为准。另：移除逐文件 uid 主线程查询（uid 需要时用 `godot_resolve_uid` 按需查询）、遍历排除 `res://.godot/` 缓存目录、每 300 个文件分帧让出主线程（不再冻结编辑器）、编辑器文件系统重扫中返回 `scanning` 标记供稍后重试。
- **`godot_inspect_script` 恒返回空修复**：`get_constants()` / `can_reload()` 均为版本敏感 API（4.6/4.7 已移除），无守卫调用会运行时中断整个函数 → 响应为空对象（全 none + 无 extends）。改为 `has_method` 守卫 + 引擎反射为空时从源码提取（func / @export / signal / const）兜底；方法返回类型改从 `return` 子字段提取（顶层无 `type` 字段）。
- **`godot_lint_scripts` 误报 class_name 脚本**：裸脚本 reload 对含 `class_name` 的合法脚本伪报 Parse error；`--check-only` 子进程改为 exit code + 输出双信号判定（exit 0 即判合法），不再回退错误码文案误报。
- **`godot_get_node_properties` 补 hint 详情**：`hint` 输出语义名（RANGE / ENUM / …），新增 `hintString`（range 的 min/max/step、enum 成员列表、数组元素类型线索）。
- **`godot_open_scenes` 无场景时返回 `[]`**：过滤 `EditorInterface.get_open_scenes()` 返回的空字符串条目。

### 修复（chat / 其他）

- **长会话发送消息不再弹到上面**：虚拟列表贴底与异步行测量解耦——启用 tanstack `anchorTo: "end"` 贴底补偿（测量完成当帧同步修正滚动位置），尾行不可见时也保持跟随；"回到底部"按钮层级修复（`isolation: isolate`，不再被消息气泡盖住）。
- **供应商模型残留**：档案编辑删除的模型不再残留在模型选择器——按档案声明的模型 id 过滤（Pi 内置目录合并残留同步收敛，大小写不敏感）。

### 改进

- **打包仅 NSIS 安装包**：移除 portable 便携版产物，安装包为唯一分发形态（CI 产物匹配同步收紧）。
- **Godot RPC 诊断**：桥接侧新增请求发送 / 响应命中（含 unmatched）/ 超时日志（`X_AGENT_DEBUG=1` 可见）；插件侧 `recv/send` 闭环 print（编辑器 Output 面板），RPC 链路问题可远程定位。

### UI 与设计规范

- **Composer 状态行动画化并常驻**：移植 thinking-orbs（MIT © Jakub Antalik）点阵思考球引擎（`src/lib/thinking-orbs/`）——空闲时显示呼吸环「已就绪」，模型响应中显示粒子轨道，接收回复时切换波形环，自动重试时显示星座连线；四态之间 350ms 交叉溶解过渡，离屏 / 标签隐藏自动暂停，`prefers-reduced-motion` 下渲染静态帧。
- **顶栏去重**：移除 TopBar 的 status-chip 状态徽标（运行中 / 空闲），状态语义统一由 Composer 状态行承载。

## 0.5.1

### 安全（全面审查后修复）

- **命令注入修复（高危）**：Windows 下 `pi.cmd` 经 `cmd.exe` 执行时 Node 对 args 只做拼接不转义（DEP0190）。`spawnCli` 现对每个参数做完整 cmd 转义（含 `%` 环境变量展开防护）；`installPackage` / `uninstallPackage` 入口加包源格式白名单（仅 `npm:` / `git+` / `https:` / `ssh:` 或本机存在的目录）。
- **SSRF 防护统一**：`fetchProviderModels` 与供应商档案 `baseUrl` 保存侧均接入 URL 校验——仅 http(s) 且 host 非回环 / 私网 / 链路本地 / 已知 DNS 重绑定域（`localtest.me` / `*.nip.io` 等）；`validateExternalHttpUrl` 补 IPv4-mapped IPv6 十六进制形态（`::ffff:7f00:1`）绕过，并对域名做 DNS 解析后校验。本地 LLM（Ollama 等）需经公网代理中转。
- **Ask/Plan 只读硬闸加深**：
  - bash 只读过滤补拦：裸 `git stash`（= stash push）、`git branch <名>` / `git tag <名>` / `git remote add|set-url` 等 ref/config 写入、`$VAR` / `~` / `$'…'` 展开、`>|` / `<` 重定向、`date -s`；路径检查支持 `~` 展开判越界与 Windows 大小写归一，`..foo` 不再误拦。
  - `read` / `grep` / `find` / `ls` / `godot_detect_project` 的 `path` 参数现强制落在项目 cwd 内（Pi 工具会展开 `~` / 绝对路径 / `file://`）。
- **Godot 工具开关不可绕过**：`godotRpcRequest` 现校验 `prefs.tools` 是否启用对应工具（GODOT_TOOLS 默认关闭的硬闸从纯 UI 偏好恢复为安全边界），并做参数长度/类型钳制。
- **IPC sender 统一校验**：全部 87 个 invoke handler 经包装器校验来源（主窗口 webContents + frame origin 匹配），纵深防御。
- **lastProjectPath 路径约束**：`patchPrefs` 仅接受已存在目录；Godot addon 安装 / 编辑器启动消费处二次确认。
- **主窗口 `sandbox: true`**：preload 改为 CJS 单文件（关闭 externalizeDeps，仅依赖 electron 受限 API），`contextBridge` 不再是唯一防线。
- **供应商密钥保护**：safeStorage 解密失败（换机器 / 密钥环重置）时保留盘上密文（`encryptedKey`），任一次保存不再用空串覆盖导致密钥永久丢失。
- **外部链接 / 导航边界**：`will-navigate` 改 origin 精确匹配（堵 `127.0.0.1:5173.evil.com` 前缀伪匹配）。

### 修复（数据完整性与健壮性）

- **撤回与发送竞态**：prompt 的「检查点准备 → session.prompt」过渡窗口内撤回被拒绝；撤回后丢弃未绑定的 pending pre-sha，旧状态不再「复活」。
- **Shadow 撤回按 diff 路径还原**：不再整库 `reset --hard`（会静默丢弃回合期间的用户手动编辑）——只还原该回合内变化过的文件；预览文案同步说明。
- **供应商档案并发**：`importExistingProviderProfiles` 读-改-写整体纳入 storePath 锁；`syncProfileToPi` 的 activeId 更新在锁内重读最新 store；`repairDeepSeekModelsJson` 改走锁 + 原子写。
- **chat 归并修复**：pending 气泡替换保留占位 id（消除虚拟行 remount 闪烁）、按 FIFO 替换未确认项（连发两条不再内容互换）；发送按钮在 pending 未确认时禁用；`removePendingUser` 不误删已确认气泡。
- **检查点仓库防膨胀**：shadow commit 后 reflog expire + `gc --auto` 修剪撤回孤儿 commit；persistDirty 改增量落盘（dirtyTurns / droppedTurns），会话文件不再 O(N²) 全量快照。
- **settings.json 双写入方原子化**：bash `shellPath` 与 Pi 包 sources 统一走同步 tmp+rename 原子写，字段互不覆盖。
- **其余健壮性**：session 损坏自动备份 `.broken-*.bak`；`deleteSession` / `godotRpcStop` 异常不再挂死 IPC；prompt / 计划正文 / 目标条件加长度上限；auth-check 缓存加 5s TTL + 窗口 focus 失效；Godot 编辑器启动等 `spawn` 事件确认成功；断连的编辑器在途请求立即报错（不再悬挂满超时）。

### Godot 集成

- **插件 0.6.2**：`lint_scripts` 的 `--check-only` 子进程改子线程执行、`wait_for_import_done` 忙等改帧循环（编辑器不再被冻结 N×30s / 60s）；`get_scene_tree` / `get_node_properties` 只读捕获不再切换当前编辑场景（load 失败返回错误而非错场景树）；`export_project` 的 `output_dir` 目录判定支持反斜杠与已存在目录；节点树序列化加 5000 节点预算（巨型场景截断）；调试会话 / 断点记录随会话结束清理。
- **多编辑器路由**：显式选中的客户端未鉴权时不再静默改道（直接报错）；自动回退时响应携带 `routedTo` 供 UI/工具详情展示；客户端列表只显示已鉴权编辑器。
- **Ask/Plan 白名单补全**：1.0 + 1.3 共 10 个纯只读 Godot 工具（`godot_open_scenes` / `godot_edited_scene` / `godot_play_errors` / `godot_list_project_files` / `godot_resolve_uid` / `godot_list_global_classes` / `godot_find_class_name_conflicts` / `godot_inspect_script` / `godot_list_export_presets` / `godot_check_export_templates`）在 Ask/Plan 模式放行。
- **export 超时对齐**：桥接侧在插件 5 分钟超时外追加 15s 余量，保证插件先收尾回结果；端口回退固定在插件候选表 8765–8774 内环绕。

### UI 与设计规范

- bash 诊断状态 emoji 改 `settings-status` 色点 chip；bash 诊断块硬编码色值 / 未定义 token 全部 token 化（`--accent-*` + color-mix）。
- 4 个未定义 CSS 变量修正（starter chip / 计划 todo 背景透明问题）；字重统一 400/500（4 处 600 降级）；硬编码圆角（999px×10 / 6px / 8px / 4px）全部走 `--radius-*`。
- ready-strip 的 inset 阴影改 `border-left`；设置页脚渐隐改纯色（skeleton shimmer 按规范豁免保留）；sidebar 冲突的 overflow 声明修复。
- 右栏宽度默认/下限统一 360（与 prefs 默认及 DESIGN.md 一致）。
- IPC promise 未捕获 rejection ×5 补齐；会话切换清空过期排队 steer；大文件预览截断提示。
- 21 处扁平 `setPrefs` / `getPrefs` / `checkAuth` 等迁移到 `window.xAgent.prefs.*` 分面。

### 测试

- 新增/扩充断言：bash 只读硬闸 +38、外部 URL 校验 +11、包源白名单 +13、模式 guard 路径约束 +11、双 pending 归并 +3、撤回竞态 +2、密文保留 +1 全链路、路径级还原 +1、1.3 只读白名单 +1 等；vitest 200 用例、离线链 54 脚本全绿。

## 0.5.0

### 功能

- **Plan 右栏支持 Markdown 渲染预览**：右侧面板 Plan tab 新增「渲染 / 源码」切换（默认渲染预览），复用聊天区的 Markdown 渲染（标题 / 列表 / 代码块 / GFM 表格，http(s) 链接经系统浏览器打开）；todo 勾选区在两种模式下都可用。源码编辑与「保存 / 保存到项目 / 执行计划 / 清除引用」行为不变。
- **计划引用跨重启持久化**：计划文件本身一直在磁盘（`~/.pi/agent/x-agent/plans/` 或 `<cwd>/.pi/plans/`），但会话内的计划引用（planPath）此前仅存内存，重启后丢失。现按会话持久化到 `~/.pi/agent/x-agent/plan-refs/`：重启后打开历史会话自动恢复右栏计划，可直接继续「执行计划」；删除会话时引用一并清理；文件被删或路径越界（home / workspace 之外）时自动丢弃，不残留报错。
- **Godot 工具扩展（1.3 全量 — 8 个只读内省工具）**：Agent 工具集新增 8 个只读类 Godot 工具，默认归 GODOT_TOOLS 开关、需用户手动启用，类型跨度从项目结构到导出预检：`godot_list_project_files`（按 `type` / 子串 `pattern` 过滤 `res://` 文件树，`limit` 默认 500、上限 5000，带 `cursor` 分页）、`godot_resolve_uid`（`res://` ↔ `uid://` 双向查，要求二选一）、`godot_wait_for_import_done`（轮询 EditorFileSystem 完成指定路径的 import，默认等待 30s、上限 60s）、`godot_list_global_classes`（`ProjectSettings.get_global_class_list()` 透出）、`godot_find_class_name_conflicts`（扫 `.gd` 顶部 `class_name` 声明找出重复名，默认排除 `addons/`）、`godot_inspect_script`（反射 GDScript 的 signals / methods / properties / constants 与 `base_script`、`instance_base_type`）、`godot_list_export_presets`（行级解析 `export_presets.cfg` 的 `[preset.N]` 段）、`godot_check_export_templates`（列 `{OS.get_config_dir()}/export_templates/<version>/` 下模板文件并报告 installed 状态与缺失平台）。设置页「项目内省（只读 1.3）」区块同步加 5 个直接 RPC 调试按钮（列出文件 / 全局类名 / 导出预设 / 模板状态 / 反射脚本）。Godot 插件 `plugin.cfg` / `plugin.gd` 版本号升到 0.6.0。

### 修复

- **Plan 澄清（<clarify>）多问题解析**：多行 clarify 块内连续 Q1/Q2/Q3 各自带选项时，旧解析把全部选项并到第一个问题（选项串组）。现按 Q 行分组，每个问题只收自己名下的选项；同时支持无 `- ` 前缀的 `A:` / `A：` 选项行，并统一剥掉 `选项 X:` / `X:` 前缀。
- **全屏时输入框文本从屏幕中间开始**：输入框 `max-width: 760px` + 水平居中，窄窗下无感，全屏宽窗下光标与输入文本从屏幕中间开始。改为左对齐，与消息气泡左缘一致。
- **Godot 工具有效性修正（4 项）**：
  - `godot_list_project_files` cursor 分页重写：旧实现每页从目录起点重新收集文件，目录文件数超 `limit` 时下一页与上一页完全相同（翻页死循环），且 `total` 重复计数。新实现 cursor 为 `"#N"`（N = 已返回匹配数），插件全量遍历统计 `total`（过滤 type/pattern 后的匹配总数，不随翻页变化）、按 N 跳过已返回项；旧格式纯路径 cursor 保持兼容。
  - `godot_wait_for_import_done` 入参校验：相对路径自动补 `res://` 前缀，绝对路径（盘符 / POSIX / UNC）直接报错，插件侧同步 strip + 前缀防御，避免 `.import` sidecar 检查失效。
  - `godot_check_export_templates` 模板目录路径修正：`exported/templates` → Godot 实际使用的 `export_templates`（旧路径恒查不到 → installed 永远为 false）；`missingPlatforms` 由恒空改为按已知平台（windows / linux / macos / web / android / ios）枚举全缺平台。
  - `plugin.gd` 5 处 GDScript 解析错误修复（`var :=` 对无类型返回值推断失败）：`EditorFileSystemDirectory.get_file_uid`（4.7 不存在）改走 `ResourceLoader.get_resource_uid`；`find_class_name_conflicts` 的 BFS 队列补 `Array[EditorFileSystemDirectory]` 元素类型。
- **electron-vite `vite:esm-shim` 注入破坏主进程构建**：插件用朴素正则定位 chunk 最后一个 import 语句，`godot_wait_for_import_done` 的 `promptSnippet` 以 `import"` 结尾时误判并把 CommonJS shim 插进字符串字面量中间（esbuild 报 Unterminated string literal，`npm run dev` / `build` 直接失败）。通过改写 promptSnippet 文案规避误匹配。


### 0.4.x 累计变更

以下为 0.4.0 起各小版本面向用户的说明汇总（新→旧）。

#### 0.4.1

### 变更

- **架构 · IPC 单一事实源**：`shared/ipc.ts` 新增 `IpcInvokeMap`——87 个 invoke 通道的权威签名（channel 名 → 参数 → 返回），preload 转发与主进程 handler 注册都由它派生，`XAgentApiFlat` 从 90 个手工签名收敛为 `Omit<FlatInvokeApi, DeletedFlatKey> & 3 特例`；preload 约 176 行手工转发改为循环生成（`makeInvokeApi`）；主进程侧新增类型锚定的 `handle()` 注册器，6 个 `register-*-ipc.ts` 全部接入。「新增/改名 IPC 必须同步四处」的人肉约定由编译期断言接管（通道键 ↔ 映射键全覆盖、删除名单合法性），漏同步从运行期静默失败变为编译期报错。
- **架构 · 门面收尾与死代码清理**：删除 7 个从未接线的分面类型（`ProjectApi` / `GodotApi` / `PluginsApi` / `ProvidersApi` / `PackagesApi` / `UsageApi`）；`window.xAgent` 扁平面按 `DELETED_FLAT_KEYS` 收窄 36 个零消费者方法（`openProject` / `prompt` / `setModel` 等全部迁到分面），renderer 侧 4 处调用方迁移到 `session` 分面；删除 `messagesToHistory`（无生产消费者）、`provider-activate.ts` 兼容壳与 `activateProviderProfile`（IPC 通道已下线，测试改走生产路径 `setProviderProfileEnabled`）、`register-session-ipc.ts` 纯组合器。
- **架构 · 撤回还原接缝**：`ShadowCheckpointTracker`（git 检查点）与 `TurnFileTracker`（write/edit 基线）两个真实还原适配器之间建立共享接口 `RestoreSource`（preview / restore / kind），编排器经 `CompositeRestoreSource` 调度（优先级、失败降级、警告合并、bash/Godot 不可还原增强统一收敛）——新增还原源不再改编排器。
- **架构 · 存储事务化**：新增深模块 `Store<T>`（`lib/store.ts`），`mutate(fn)` 把「读-改-写 + 原子写 + 缓存」整体放进锁内；prefs / usage / provider 三处存储迁移，修复并发 patch 丢更新残留（此前锁只包写、读在锁外）；Pi 侧 `auth.json` / `models.json` 由裸写改为原子写 + per-path 锁。
- **架构 · 转录贴底输入判定加深**：ChatTranscript 内 7 组原生事件监听里的「输入 → 取消贴底」判定（滚轮向上 / PageUp/Home/ArrowUp / touch 上滑 8px）抽为纯函数模块 `src/lib/chat-unpin-input.ts`（复用 `chat-scroll-pin` 几何谓词，不复制），行为测试 `test-chat-unpin-input` 接入 `npm test` 链。
- **架构 · 会话宿主接口瘦身**：按消费方真实使用统计裁剪 3 个零消费 host 接口项（`getResourceLoader` / `getBaseAppendPrompt` / `setBaseAppendPrompt`），假想接缝宽度 51 → 48。

### 功能

- **godot_detect_project 抽模块 + Plan / Ask 默认放行**：godot-pi 扩展把 `godot-helpers.ts` 里的 `project.godot` 探测拆为独立 `godot-project-detect.ts`（纯 fs 解析器，无 Pi 依赖，方便单测）；`shared/mode-tools.ts` 新增 `PLAN_MODE_OPTIONAL_READONLY_EXTENSION_TOOLS` 常量，将 godot-pi Package 注册的扩展只读工具与 prefs 开关解耦——Plan / Ask 模式默认放行 `godot_detect_project`，调研场景不再需要先在设置勾选。

### 测试

- **新增 Vitest 覆盖**：`lib/store.test.ts`（20 并发 mutate 无丢更新回归）、`restore-source.test.ts`（调度优先级 / 降级 / 警告合并 6 用例）、`register-ipc.test.ts`（通道注册表一致性 + 注册器转发）；离线测试链新增 `test-chat-unpin-input.ts`、`test-godot-detect-project.ts`（8 用例锁住 `project.godot` 解析契约）、`test-inject-splash-version.ts`（9 用例覆盖占位符 / 幂等 / mismatch / checkOnly / 边界 markup）。

### 改进

- **底部工具条重构**：将「模型 / Thinking / 展示思考」三组设置从 TopBar 移到 ChatPanel 底部工具条，与既有的 4 个会话模式 pill（智能体 / 调研 / 计划 / 目标）合并为单行布局；删除原有的 `.composer-mode-bar` 独立行与 `.composer-hint` 提示文案，模式 pill 拆除外层圆角容器改为独立 pill。响应式断点重写：≤1280px 隐藏字段标签、≤900px 模式行独占一行、≤700px 模式 pill 文字隐藏仅图标，统一由 `.composer-actions` 的 `margin-left: auto` 把发送按钮锚到工具条右侧，避免窄屏时「发送」单独换行落到第三行。
- **底部工具条强制两行**：`.composer-toolbar` 改为 grid（`1fr auto` × 2 行，`mode-row` 跨满整行），模式按钮恒占第 1 行、模型设置 + 发送按钮恒占第 2 行，告别「窄屏下发送按钮单独换到第 3 行」的抖动；`composer-model-row` 内部 `flex-wrap: nowrap` 锁住「模型 + Thinking + 展示思考」一行不拆。
- **侧栏 / 工具栏宽度钉死区间**：`SIDEBAR_WIDTH_MAX` 480 → 269、`RIGHT_PANEL_WIDTH_MIN/MAX` 240-640 → 400-507、`RIGHT_PANEL_WIDTH_DEFAULT` 360 → 480 落在新区间内；老 prefs 越界值加载时由 `clampWidth` 自动夹紧。
- **composer-shell 模式色边框**：`.composer-shell` 加 `data-mode` 钩子，按当前会话模式（智能体 / 调研 / 计划 / 目标）映射到 `accent-blue / ctx-messages / ctx-skills / accent-yellow` 四色，与模式 pill 复用同一调色板；默认淡 35% 混合、hover 65%、focus 实色 + 30% box-shadow，当前模式一眼可见。
- **启动页版本号自动注入**：splash.html 静态 `v0.3.12` 易落后版本号；新增 `scripts/inject-splash-version.ts`（`package.json` `predev` / `prebuild` 钩子）从 `version` 字段注入 `v…` 标记，占位符首次替换、后续版本号漂移自动改写、`--check-only` 留给 CI 校验；离线测试 `test-inject-splash-version.ts` 锁住占位符 / 幂等 / mismatch / checkOnly / 边界 markup 9 条契约。
- **ROADMAP 阶段调整**：移除 1.3 跨平台（macOS / Linux）阶段（聚焦 Windows 单一平台），对应调整 1.3 i18n / 1.4 Godot 项目 lint / 1.5 @-补全 / 1.6 E2E 契约锁 编号表述与 mermaid 依赖图；其余验收项不变。

#### 0.4.0

### 功能

- **Godot 工具扩展（1.2 全量）**：新增 7 个编辑器工具（Godot 插件 0.5.0）——`godot_get/set_project_setting`（读写 project.godot 配置）、`godot_lint_scripts`（GDScript 静态检查，带行号）、`godot_find_unused_resources`（未使用资源扫描）、`godot_export_project`（headless 子进程出包，不阻塞编辑器）、`godot_get_debugger_state` / `godot_set_breakpoint`（调试器状态与断点，会话启动自动重放）。只读工具进入 Ask / Plan 模式白名单，写型工具计入撤回告警。

### 修复

- **@-补全空白路径误判**：`looksLikePathCandidate` 正则未锚定，`"foo bar"` 等含空白片段被误判为路径候选（该测试曾因未纳入 vitest 而从未运行，0.4.0 激活后暴露）。
- **会话重命名过期提交**：编辑会话名后 120ms 内点击其他会话，会提交过期编辑；现焦点落在会话列表内时跳过提交（onResume 负责切换）。
- **Godot 面板轮询闭包陈旧**：`GodotTab` 轮询依赖缺失导致闭包引用旧 refresh；已 useCallback 化并补全依赖。
- **渲染期写 ref**：`App.tsx` 在渲染函数体内写入 `apiStatusRef`，并发渲染下可能中断；改为 effect 同步。

### 改进

- **依赖全量升级**：Electron 35 → 43、Vite 6 → 7、Vitest 2 → 4、TypeScript 5.9 → 7.0（移除 `baseUrl`，paths 相对化）、electron-vite 3 → 5、`@earendil-works/pi-coding-agent` 0.80 → 0.83（`ModelRuntime.reloadConfig` 迁移到 `refresh()`）；Playwright E2E 在 Electron 43 下通过。
- **死代码清理（0.4.0 梳理）**：删除 7 个无引用文件（`history.ts` / `transcript-mapper.ts` / `SkillSlashMenu` / `skill-slash` / 3 个 barrel index）、约 15 个无消费者导出（`loadPrefsAsync` / `getAllowedPluginRoots` / `syncActiveProfileToPi` 等）、2 条无人调用的 IPC 链路（`activateProviderProfile` / `listSessionSkills`）、preload 6 个 renderer 零使用分面、`syncedActive` 等过期字段。
- **测试体系收敛**：退役 4 组双重覆盖的离线脚本（cwd-sandbox / usage-store / godot-rpc-bridge / shadow-checkpoints），由 Vitest 独占；vitest 纳入 `src/**` 并激活 `at-completion` 测试；补 `project-fs` / `mode-tools` / `mode-prompt` 覆盖（覆盖率 60% 门槛 → 实际 82%+）；删除重复的「重置教程环境.bat」。
- **重复实现收敛**：`THINKING_LEVELS` / `applyTheme` 收敛到单点（`@shared/ipc` / `src/lib/theme.ts`）；`WRITE_PLAN_TOOL` 统一 import 自 `shared/mode-tools.ts`。


### 0.3.x 累计变更

以下为 0.3.0 起各小版本面向用户的说明汇总（新→旧）。

#### 0.3.14

### 功能

- **@ 补全菜单**：聊天输入框输入 `@` 弹出三类候选（技能 / 会话模式 / 文件路径），选中即插入，长列表带键盘导航与排序去重（`useAtCompletion` + `AtMenu`）。
- **Godot 场景内省**：新增 `get_scene_tree` / `get_node_properties` 两个 RPC 方法（Godot 插件 0.4.0），Agent 可直接查看当前场景的节点树与节点属性，为场景级编辑提供上下文。
- **连续工具调用折叠**：同一回合的连续 tool 调用自动折叠为可展开批次，长工具序列不再占满对话；运行中的批次不自动展开，完成后可一键展开 / 收起（`ToolBatch` + `test-tool-batches` 契约锁定）。

### 修复

- **确认弹窗「第一次点击无效果」**：在工具白名单切换等需要 confirm 的场景下，用户快速连续点击切换按钮（或自动批处理、键盘连按等）会让前一次的 await confirm(...) 永远不 resolve —— pendingRef.current 被新调用覆盖，前一次的 resolve 函数丢失，表现为「要点两次确认才生效」。src/lib/app-confirm.tsx 新 confirm 启动前先把旧的 pending resolve 为 false，避免 Promise 泄露。新增 scripts/test-confirm-provider.ts 锁住合约。
- **Godot RPC 断开后无法自动重连**：桥接关闭期间插件每次重连都重置回主端口，fallback 端口（8765–8774）从未被遍历（本机端口无监听是立即 RST，不会走连接超时推进路径），桥接重启后端口 / token 变化时插件永远连不上。插件 0.4.1 重写重连调度：每次重连前重读 endpoint 感知配置变化、同一端口连续重试约 2s 后推进下一候选端口、重连间隔缩短到 0.5s，桥接重启后 0.5–1s 内自动恢复，无需重启编辑器；Godot 设置页同步增加桥接状态轮询，连接 / 断开实时可见。
- **Plan 内联 `<clarify>` 解析**：模型输出带 markdown 包裹的内联 clarify 块时按块边界解析而不是整段吞掉，选项可正常点选发送（`test-plan-clarify` 锁定）。

### 改进

- **Plan 澄清面板重设计**：多题 clarify 选项面板重构选中态 / 间距 / 布局，误触率下降、可见性提升。
- **bash 健康探针 + 设置诊断**：设置页新增 bash 环境诊断，显示 liveness 探测结果与 shell 路径问题，排查更快。
- **工程化 · CI 门槛**：引入 Vitest 单测（node 环境，含 cwd-sandbox / retract-orchestrator / shadow-checkpoints / usage-store / godot-rpc-bridge 关键模块）+ Playwright E2E 基础用例（应用外壳 / 模式切换），CI 增加测试与覆盖率门槛。
- **文档**：新增 `AGENTS.md` 仓库协作入口 + `ROADMAP.md`（1.1 / 1.6 完成标记），开发者与 Agent 上手路径补齐。

#### 0.3.13

### 改进

- **Godot RPC 自动重连**：X-agent 启动时优先复用上次 endpoint 的 token 与端口，已运行的 Godot 插件通常无需任何操作即可在 ~1s 内握手成功（Godot 插件 0.3.0+ 每秒轮询 endpoint 文件 mtime，变更即跳到正确端口）。就绪清单 `rpcBridge` 状态新增 8s 启动宽限；区分「握手失败 → 更新 RPC 插件」与「未连接 → 启动编辑器」，并透出 `lastHandshakeFailure` 与插件版本号。`stop()` 不再删除 endpoint 文件（崩溃 / `taskkill` 路径行为对齐）。0.2.0 旧插件仍能工作，只是不上报 `addonVersion`。
- **调试模式**：开发运行默认打开独立 DevTools；打包版可用 `--x-agent-debug` / `--debug-ui` 或 `X_AGENT_DEBUG=1` 开启，并支持 `F12`、`Ctrl+Shift+I` 切换。
- **启动页**：移除硬编码灰底，改用 `transparent` + HTML 自绘圆角背景，Win11 22H2+ 同时启用 DWM 原生 `roundedCorners`；加载完成 320ms 淡出再 reveal 主窗口，避免视觉跳变。

### 修复

- **长对话消息显示混乱**：对话一旦超过一屏（达到虚拟列表阈值）后，流式追加、assistant 收尾、中间插入 tool 行等路径都出现过行重叠 / 错位。根因是 `ChatTranscript` 在「行数变化」与「status 切换」两个 `useLayoutEffect` 里调用全量 `virtualizer.measure()`，它会清空 tanstack 的整个 `itemSizeCache`，已挂载行全部退回估算高度，长行之后的下一行仍按 estimate 定位造成重叠。现改为依赖新挂载行 ref 实测 + 内部 ResizeObserver 校正，并新增 `test-chat-virtual-cache` 契约测试锁住「禁止全量重测」。
- **气泡 / 工具调用被裁剪**：虚拟行的 `overflow: hidden` 会裁掉连续折叠工具条的紧凑负边距与流式内容，操作头也会被相邻的 transform 行盖住。现改为行盒允许可见溢出，不再为气泡预留布局空间；由行本身按消息顺序反向叠放，并在展开 / 悬停时提升到顶层，让气泡按约定覆盖下方内容；`test-chat-transcript-virtual` 锁住该层叠与溢出契约。
- **Godot RPC 就绪清单离线分支**：原 `bridgeInGrace` 条件在桥接未启动时也会判为「在宽限期」，导致「启动 RPC 桥接」入口漏出。修正后仅当桥接在跑且未超过 8s 才视为宽限内。
- **Godot RPC 端口回退测试**：用 `withIsolatedEndpoint` 隔离 endpoint 文件，避免开发者机器上残留的 endpoint 让端口回退测试改走本机目录。

#### 0.3.12

### 功能

- **更新提示**：安装版静默检查到新版本时不自动下载，应用内提示条「立即更新 / 稍后」并在顶栏显示入口，引导用户按需下载或安装。

### 变更

- **架构 · 主进程 IO 与校验加固**：prefs / usage / provider / auth / godot-rpc 五处持久化改为原子写（tmp + rename），prefs 与 usage 改走 `withStoreLock(path, ...)` 串行化（与 provider 同模式）；safeStorage 不可用时启动一次 probe 并在 UI 横幅告知「密钥以明文存储」；`setPrefs` 走 `ClientPrefsPatchSchema`（`additionalProperties: false`）拒绝未声明字段；`external-url` 显式拒绝 IPv4-mapped IPv6 / link-local / ULA / zone-id；`cwd-sandbox` 与 `plan-tools` 路径前缀比对做 Windows 大小写归一化；`applyBashShellPath` 写入前对 target 做 `--version` 自检。`bash-readonly` / `plan-mode-guard` / `plan-tools` / `goal-evaluator` / `goal-journal` / `session-mode` 6 个废弃入口合并到 `session-mode/*`。
- **UI 拆分**：`PluginsPage`（805 → 90）/ `Sidebar`（528 → 105）拆到 `./plugins/` `./sidebar/` 子目录，顶层只保留壳与 re-export 兼容；`ChatTranscript` virtualizer 配置抽到 `src/lib/chat-transcript-virtual.ts`，5 个 bubble 子组件抽到 `./chat/bubbles.tsx`；`ChatPanel` 拆出 `useSlashMenu` hook 并加 `React.memo` 顶层包装。

### 改进

- **会话模式切换**：智能体 / 调研 / 计划 / 目标四种模式统一使用中文标签，并以蓝 / 青 / 紫 / 黄图标和同色选中态区分；补充 hover、禁用与 `aria-pressed` 状态，保留 `Shift+Tab` 快捷切换。
- **供应商启用约束**：始终保留至少一个启用档案；最后一个启用档案不能被关闭、删除或保存为禁用，设置页会直接解释原因，避免模型列表被清空。
- **发版流程**：本机 `release:dist` 改为可选冒烟；用户下载的权威产物以 CI GitHub Release 为准。
- **工程化**：新增 `apps/desktop/.editorconfig`（UTF-8 / LF / 2 空格缩进 / 去行尾空格 / 末尾换行），停止跟踪 `*.tsbuildinfo`，并将供应商认证缓存回归测试纳入完整测试链。
- **开发文档**：新增 `AGENT.md` 仓库协作指南；同步 `CONTEXT.md` / `CLAUDE.md` 的模块路径与发版约定；补充 Godot TileSet 结构格式调研，并明确本地 ADR / 调研草稿不参与发布。

### 修复

- **prefs 并发丢更新**：`savePrefs` 加 `withStoreLock(path, ...)` 串行化，并发 `patchPrefs` 不再读到同一快照后写覆盖前写；`usage-store` 同步去掉自管 `writeQueue`，统一走 `withStoreLock`。
- **供应商同步与模型过滤**：`providerId` 与 Pi 配置 key 漂移时，按 `baseUrl` 家族回退匹配并清理 `auth.json` / `models.json`，顶栏不再残留已停用模型；启用路径改为静态 ESM 导入，修复打包后切换供应商时的 `Cannot find module`。
- **供应商认证状态缓存**：新增或删除供应商写入 `auth.json` 后主动失效 `checkAuth` 缓存，ReadyChecklist 不再继续误报「未配置供应商」。
- **Windows 发布产物覆盖**：NSIS 安装包与 Portable 便携包使用独立文件名，避免后构建的便携包覆盖安装包，确保 `latest.yml` 的大小与 SHA-512 可用于自动更新校验。

#### 0.3.11

### 修复

- **对话卡顿 + 流式期间无法浏览历史**：流式增量每帧都触发整树 ReactMarkdown 全量重解析 + 强制关闭虚拟化 + 双 rAF 抢回 scrollTop，三者叠加导致长文本流式期间主线程被吃满、用户拖滚动条被强抢。MarkdownBody 在 streaming 时降级到 plain `<pre>`，assistant_end 后一次解析定型；长对话在 streaming 期也走虚拟列表（≥ 24 条）；用 IntersectionObserver 观察尾节点，pinned 才 follow，未 pinned 绝不抢滚动条。

### 改进

- **App / ChatPanel 回调 memo 化**：把传进 ChatPanel / Sidebar 的 inline lambda 全部 `useCallback` 化；TopBar / Sidebar 加 `React.memo`，流式事件不再触发无关组件重渲染。MarkdownBody / UserMessageBody / ToolRow 内部的 `JSON.stringify` / `splitUserMessageFileBlocks` 用 `useMemo` 缓存。

#### 0.3.10

### 功能

- **插件 · 技能开关**：设置 → 插件 → 技能可逐项 / 批量启用或关闭；`disabledSkills` 黑名单持久化，关闭后不进入会话索引与 `/skill` 菜单

### 变更

- **Godot 文档**：移除内置离线文档工具 / 缓存与设置页「官方文档」；改为 `godot-pi` 的 `godot-docs-4-7` 技能（仅 Godot 项目索引）。优化后的 Godot 技能已能很好替代原查询文档能力；基于精简 tool 的原则，去除文档检索工具。
- **godot-pi**：删除细粒度 `godot-*` 惯例技能，统一由文档技能覆盖

### 改进

- **Godot 设置**：页签仅保留编辑器连接与 RPC
- **就绪清单 / 工具白名单**：去掉 Godot 文档工具相关项

### 修复

- **技能页白屏**：旧偏好缺少 `disabledSkills` 时不再崩溃；列表项改为合法 DOM（checkbox 不再嵌在 button 内）

#### 0.3.9

### 修复

- **Ask/Plan bash 硬闸**：按换行切段；拒绝 `$()` / 反引号 / `${}` 命令替换；`godot` / `dotnet` 不再视为只读
- **Goal 预算**：撤回后回滚 `turns` / `tokensUsed`，避免双计；续轮改为 settled 外异步 prompt，避免嵌套竞态
- **会话边界**：`prompt` / `abort` 校验 session bundle epoch，切换/释放会话后不再写错检查点
- **打开项目**：忽略按钮把 `MouseEvent` 当成路径传入导致打开失败
- **Plan 右栏**：切换计划时立即清空旧 markdown，避免短暂串显
- **文件树**：刷新不再并发双 IPC
- **工具卡片**：`tool_update` 在完成后忽略迟到的 partial，避免覆盖最终结果
- **Godot 文档**：选「自定义…」只展开输入，不再立刻用当前分支空调一次

### 改进

- **发送体验**：用户消息乐观气泡（Shadow 检查点完成前即可看见）
- **安全收紧**：Godot RPC method allowlist；外链拒绝本地/私网地址；`will-navigate` 拒绝非本应用 `file:`；`pi install` 跳过 npm lifecycle scripts；单实例锁
- **性能**：流式 `text_delta` / `thinking_delta` 尾部 O(1) 更新；无变化时跳过全量 `history_replace`
- **代码审查**：见 `0.3.8` 之前提交 / `git log --since=2026-08-01`；分诊结论已落入上面各条

#### 0.3.8

### 功能

- **Goal 护栏**：轮次 + token 双预算（`goalMaxTurns` / `goalMaxTokens`）、暂停 / 继续、评估失败自动暂停；日记落盘 `~/.pi/agent/x-agent/goals/`（删会话时清理）
- **Plan / 调研**：bash 只读分类器 + 项目 cwd 路径硬约束；`<clarify>` 多题点选后「发送所选」；计划 todos 勾选；Shift+Tab 循环模式
- **供应商密钥**：`x-agent-providers.json` 尽量用 Electron `safeStorage` 加密（启用时仍写入 Pi `auth.json`）
- **Godot RPC 握手**：endpoint 共享 token，插件 `editor_ready` 校验通过后才接受调用

### 改进

- **顶栏模型**：编辑启用订阅后同步 Pi models；去重 case 变体；下拉仅显示模型名；Thinking / 模型选择居中与首字母大写
- **设置**：目标最大轮次 / token；Shell 说明区分调研·Plan cwd 闸与 Agent 模式
- **文档 / ADR**：Ask·Plan bash 闸门、goals 路径、密钥与 RPC 握手说明；`docs/adr/` 补齐

### 修复

- **Ask/Plan bash**：禁止 python/node 任意执行与 `find -delete` 等突变；拦截目录外路径
- **供应商**：保存已启用档案时避免重复 activate
- **澄清 UI**：由单点即发改为逐题选择后统一发送

#### 0.3.7

### 功能

- **调研模式 (Ask)**：与 Agent / Plan / 目标并列；只读研究与问答（无 `write_plan`）；临时工具集 + 硬闸，不写回设置白名单

### 改进

- **工具设置**：移除「快捷档 / 只读安全档」；临时只读引导至会话「调研」或 Plan；设置页仅控制 Agent/目标默认白名单
- **会话架构**：`SessionModeController` / `RetractOrchestrator` 从 `SessionHost` 拆出；IPC `workspace` / `turn` / `plan` 分面
- **长对话**：聊天转录虚拟列表（`@tanstack/react-virtual`）；SelectMenu 滚动定位更稳

#### 0.3.6

### 功能

- **Plan Mode**：只读研究 + `write_plan`；右栏「计划」可编辑 / 保存到项目；「执行计划」切回 Agent 实施；tool_call 硬闸防误写
- **Goal Mode**：与 Agent / Plan 并列；完成条件 + 独立评估续轮，直至条件满足

### 改进

- **Plan 指令**：system append 注入（不污染用户气泡）；先研究再一次写出完整计划，拒绝 placeholder / 过短 stub；同会话修订覆盖当前计划文件
- **模式切换**：切换 Agent / Plan / Goal 时保留已有计划在右栏，需「清除引用」才丢掉

### 修复

- **工具卡片收起**：结束后强制折叠；修复受控 `<details>` 与 Chromium toggle 抢状态导致卡住展开
- **write_plan 注册**：自定义工具列入 session 白名单；新建会话后正确激活 Plan 工具集

#### 0.3.5

### 功能

- **文件预览 Markdown**：右栏「文件」对 `.md` / `.mdx` / `.markdown` 默认渲染（GFM），可切换源码
- **技能调用可见**：聊天中 `read` 加载 `SKILL.md` 时显示为「技能 · 名称」卡片，而非普通工具

### 改进

- **默认 Thinking 为 high**：更贴合 DeepSeek V4 等仅支持 off/high/max 的模型；打开/新建会话强制应用默认档，并回写钳制后的生效值
- **DeepSeek models.json**：为自定义 id（如 `deepseek-v4-pro[1M]`）补写 `reasoning` / V4 `thinkingLevelMap`，启动时修复缺字段的旧条目，避免 Thinking 被钳成 off
- **引用文件缩略**：发送后的 `<file>` 块在对话与撤回回填输入框中显示为 `@路径` 芯片（可展开）
- **对话吸底跟随**：未上翻时持续跟随最新；仅向上滚动取消跟随，避免布局抖动误取消

### 修复

- **开发环境安装 Godot RPC 插件**：兼容 electron-vite `out/main/chunks` 路径，正确找到仓库内 `packages/godot-editor-rpc`
- **打包版 addon 路径**：优先使用 `extraResources` 内置插件，避免 cwd 落在 monorepo 时误拷开发树

#### 0.3.4

### 功能

- **Shadow Git 工作区撤回**：有本机 Git 时，每轮 prompt 前打独立检查点（`~/.pi/agent/x-agent/checkpoints/`，不写用户 `.git`）；撤回 / 编辑重发优先 `reset` 到该轮 pre，覆盖 write/edit/bash 等 cwd 内改动；无 Git 时仍降级为 write/edit 字节基线
- **撤回确认**：展示还原模式（Shadow / 基线）、可还原路径与风险提示；Godot 仅对会改编辑器状态的工具告警

### 修复

- **检查点绑定时机**：Pi 在 `message_end` 之后才持久化用户消息；改为在 append 之后（`queueMicrotask` / `tool_execution_start`）绑定 active user 与 Shadow pre，避免基线与检查点绑到错误轮次导致「缺少 Shadow / 缺基线」

### 改进

- **测试**：`test-shadow-git`、`test-session-bind-timing`；文档补充撤回 / 检查点路径说明

#### 0.3.3

### 变更

- **移除 Gitee 更新源**：删除设置内更新源切换、发版 CI / `sync-gitee-release` 同步；自动更新仅使用 GitHub Releases
- **就绪清单**：关闭仅本会话隐藏；新增「不再提醒」才对本项目持久关闭 Godot 相关步骤

### 功能

- **更新体验**：打包版启动后静默检查；顶栏更新角标；设置内「打开 Releases」浏览器下载回退
- **偏好恢复**：启动时若 `x-agent.json` 损坏则备份并提示；设置 Escape / `Ctrl+,`；上下文自动压缩阈值；工具「只读安全档」

### 改进

- **设置**：供应商页拆出 `ProvidersSettingsPage`；就绪 / 更新逻辑抽 hook
- **文档**：README 补充安全与隐私说明；Godot 文档导入引导（镜像 / 本地 zip）
- **测试**：prefs recovery、update-feed resolve

#### 0.3.2

### 功能

- **项目就绪清单**：单一可折叠条替代多层横幅（认证 / bash / RPC / Godot 工具 / 文档）；桥接启动有明确反馈，等待连入时可一键启动编辑器
- **空聊天引导**：打开项目后展示 starter prompts，并可跳转 Godot / 设置
- **Godot 工具渐进启用**：桥已连接但工具仍关时提示一键启用
- **主题化确认框**：替换系统 `window.confirm`；warn/danger 默认高亮「取消」

### 改进

- **长会话聊天**：超过阈值时折叠更早消息；流式/长历史时对非尾部气泡降级为纯文本渲染
- **设置分页拆分**：通用 / 工具 / Godot 独立页面组件；Settings 壳层变薄
- **更新与签名说明**：README / CLAUDE / 设置补充 GitHub 自动更新与可选 Windows 代码签名（`CSC_LINK`）
- **工程**：`SessionHost` 拆出 helpers / event-bridge / usage；IPC channel 常量表；`project-fs` 与 Electron shell 解耦；sandbox / ready-checklist / update-feed 测试

#### 0.3.1

### 功能

- **Skill 斜杠菜单**：输入 `/` 弹出当前会话可用技能，筛选并插入 `/skill-name`
- **原生技能包分层**：`godot-pi` 含 Core（`x-*`）与 Godot 技能；非 Godot 项目不索引 `godot-*`；启动时尝试自动安装该包

### 改进

- **godot-pi**：精简大型玩法类默认技能，保留审计 / 场景 / RPC 试玩 / GDScript / 状态机等核心 Godot 技能；新增 `/x-next` 提示
- 设置 → 插件：一键安装文案改为「X-agent 原生技能包」

### 修复

- **聊天滚动**：贴底跟底不再吞掉卸钉；滚轮 / 滚动条 / 触控上翻后可离开底部，避免回弹卡住

#### 0.3.0

### 功能

- **主题化下拉**：自定义 `SelectMenu` 替换原生 `<select>`（顶栏模型 / Thinking、设置内外观与 Godot / 供应商等），下拉面板跟随主题 token
- **发版 minor 汇总**：`0.3.0` 等线起点的 CHANGELOG / GitHub Release 自动纳入上一线（`0.2.0`…`0.2.x`）全部小版本说明

### 改进

- **聊天输入**：一体化 composer 壳（输入 + 发送 / 中止），焦点环包住整块
- **输入框**：全局单行 pill、只读淡化、多行统一圆角与焦点环；Shell 路径等宽
- **设置提示**：供应商 / 通用 / Godot / 插件 / 用量反馈可关闭；成功约 4.5s 自动消失；切页签与关窗清空，避免跨页粘滞

### 开发

- `extract-changelog` / `prepare-release` 支持上一 minor 线汇总；新增 `npm run release:test-changelog`


### 0.2.x 累计变更

以下为 0.2.0 起各小版本面向用户的说明汇总（新→旧）。

#### 0.2.6

### 改进

- **展示思考**：顶栏改为开关式 chip（「展示思考」+ 开/关徽标），开时高亮
- **默认深色**：Surface 加深至 `#141414`，启动窗背景与之对齐
- 空会话去掉 steer 提示；未打开项目时仍提示先选文件夹
- 右栏上下文去掉缓存命中率长脚注，面板更干净

### 修复

- **撤回**：navigate 前预扫变更文件，navigate 后再还原，避免撤回到用户消息时文件状态错乱
- **Godot 文档引用**：回答中用本地 `absPath` 反引号路径，不再改写成 `docs.godotengine.org` 链接

### 开发

- 加深架构接缝：对话实录 `transcript-mapper`、供应商激活、会话标题、cwd 沙箱、Godot / provider / session IPC 注册拆分；`App` 侧事件路由与撤回确认抽 hook

#### 0.2.5

### 功能

- **模型上下文窗口**：供应商档案模型可配置 `contextWindow`，写入 Pi `models.json`；预设 / 拉取 `/v1/models` / 已知模型启发式自动填入（如 DeepSeek V4 → 1M），避免一律按 Pi 默认 128k 计量占用
- **缓存命中率**：右栏上下文与设置 → 用量展示 `cacheRead / (input + cacheRead)`；改工具白名单时确认并提示会重建系统提示、清空本会话前缀缓存

### 改进

- 经 SiliconFlow 等非 `api.deepseek.com` 中转的 DeepSeek 模型，激活时自动写入 Pi `thinkingFormat: deepseek` compat，保证 `reasoning_content` 回传形态正确

### 文档

- `AGENT_CONTEXT` 补充前缀缓存注意点与 `contextWindow` 说明

#### 0.2.4

### 改进

- **Godot 文档搜索**：结果带短摘要（summary）；类页 / 教程标题与排序更准确，概览可少读大 `.rst`
- **文档工具指引**：概览优先用 summary；API 查阅引导 `read(class_*.rst, limit)`

### 修复

- **右栏上下文占用**：按 prompt 侧 `input + cacheRead`（含 trailing 消息）计量，不再把上一轮 output 算进占用条
- **重载插件后工具全开**：`reload` 后重新应用用户工具白名单

### 开发

- 新增 `measure-context-baseline`：对比默认 7 工具与全开 19 工具的基线 token 估量，并纳入 `npm test`

#### 0.2.3

### 功能

- **多风格 GUI 主题**：设置 → 通用可选默认 / Nord / Tokyo Night / Warm Paper / High Contrast；顶栏仍切换深浅；偏好为 `themeId` + `colorMode`（兼容旧 `theme` / `cindy`）
- **应用图标**：窗口 / 安装包 / 网页 favicon 使用统一品牌图标
- **顶栏紧凑布局**：窄窗时隐藏部分文案，保留图标与 title

### 改进

- 窗口最小尺寸下调，并隐藏应用菜单栏
- 侧栏 / 右栏在窗口缩小时自动让出聊天区宽度

### 文档

- DESIGN 补充主题族与可变样式令牌说明
- 同步 README / CLAUDE / AGENT_CONTEXT 与 0.2.x 能力说明；修正 Godot 设置入口文案

#### 0.2.2

### 修复

- **CI / 发版测试**：`test-turn-file-tracker` 补上缺失的 `unlinkSync` 导入（symlink 用例在 Windows runner 上可用时不再 ReferenceError）

#### 0.2.1

### 功能

- **会话用量与上下文面板**：右栏「上下文」展示占用进度、组成拆解（含协议损耗）、本轮 / 会话累计用量；支持手动压缩上下文
- **用量设置**：设置 → 用量，查看本地按日 / 按模型汇总，可清空统计
- **技能加载**：不再自动加载 `~/.agents/skills`，避免无关技能索引膨胀上下文

### 修复

- **组成拆解**：API 占用与文本估算的差额单独记为「协议损耗」，不再并入系统提示

#### 0.2.0

### 功能

- **Godot 官方文档离线检索**：设置 → Godot →「官方文档」选择分支、打开下载链接并导入源码 zip；Agent 工具 `godot_docs_search` / `godot_docs_status`（默认关闭）
- **设置页整理**：Godot 拆成「编辑器连接 / 官方文档」子页签；通用 / 工具等分区卡片化；左侧导航带图标
- **工具分组一键开关**：启用工具各分组可用图标按钮整组开启 / 关闭

### 修复

- **新会话输入框偶发卡死**：切换 / 新建 / 恢复会话时清除编辑态，避免误锁输入
- **文档检索后读错路径**：搜索结果提供 `absPath`，并引导用 `read` 读本地缓存而非项目内 docs
- **Packages 安装区异常渐变**：供应商页 sticky 渐变不再误套到插件 Packages 面板

## 0.4.1

### 变更

- **架构 · IPC 单一事实源**：`shared/ipc.ts` 新增 `IpcInvokeMap`——87 个 invoke 通道的权威签名（channel 名 → 参数 → 返回），preload 转发与主进程 handler 注册都由它派生，`XAgentApiFlat` 从 90 个手工签名收敛为 `Omit<FlatInvokeApi, DeletedFlatKey> & 3 特例`；preload 约 176 行手工转发改为循环生成（`makeInvokeApi`）；主进程侧新增类型锚定的 `handle()` 注册器，6 个 `register-*-ipc.ts` 全部接入。「新增/改名 IPC 必须同步四处」的人肉约定由编译期断言接管（通道键 ↔ 映射键全覆盖、删除名单合法性），漏同步从运行期静默失败变为编译期报错。
- **架构 · 门面收尾与死代码清理**：删除 7 个从未接线的分面类型（`ProjectApi` / `GodotApi` / `PluginsApi` / `ProvidersApi` / `PackagesApi` / `UsageApi`）；`window.xAgent` 扁平面按 `DELETED_FLAT_KEYS` 收窄 36 个零消费者方法（`openProject` / `prompt` / `setModel` 等全部迁到分面），renderer 侧 4 处调用方迁移到 `session` 分面；删除 `messagesToHistory`（无生产消费者）、`provider-activate.ts` 兼容壳与 `activateProviderProfile`（IPC 通道已下线，测试改走生产路径 `setProviderProfileEnabled`）、`register-session-ipc.ts` 纯组合器。
- **架构 · 撤回还原接缝**：`ShadowCheckpointTracker`（git 检查点）与 `TurnFileTracker`（write/edit 基线）两个真实还原适配器之间建立共享接口 `RestoreSource`（preview / restore / kind），编排器经 `CompositeRestoreSource` 调度（优先级、失败降级、警告合并、bash/Godot 不可还原增强统一收敛）——新增还原源不再改编排器。
- **架构 · 存储事务化**：新增深模块 `Store<T>`（`lib/store.ts`），`mutate(fn)` 把「读-改-写 + 原子写 + 缓存」整体放进锁内；prefs / usage / provider 三处存储迁移，修复并发 patch 丢更新残留（此前锁只包写、读在锁外）；Pi 侧 `auth.json` / `models.json` 由裸写改为原子写 + per-path 锁。
- **架构 · 转录贴底输入判定加深**：ChatTranscript 内 7 组原生事件监听里的「输入 → 取消贴底」判定（滚轮向上 / PageUp/Home/ArrowUp / touch 上滑 8px）抽为纯函数模块 `src/lib/chat-unpin-input.ts`（复用 `chat-scroll-pin` 几何谓词，不复制），行为测试 `test-chat-unpin-input` 接入 `npm test` 链。
- **架构 · 会话宿主接口瘦身**：按消费方真实使用统计裁剪 3 个零消费 host 接口项（`getResourceLoader` / `getBaseAppendPrompt` / `setBaseAppendPrompt`），假想接缝宽度 51 → 48。

### 功能

- **godot_detect_project 抽模块 + Plan / Ask 默认放行**：godot-pi 扩展把 `godot-helpers.ts` 里的 `project.godot` 探测拆为独立 `godot-project-detect.ts`（纯 fs 解析器，无 Pi 依赖，方便单测）；`shared/mode-tools.ts` 新增 `PLAN_MODE_OPTIONAL_READONLY_EXTENSION_TOOLS` 常量，将 godot-pi Package 注册的扩展只读工具与 prefs 开关解耦——Plan / Ask 模式默认放行 `godot_detect_project`，调研场景不再需要先在设置勾选。

### 测试

- **新增 Vitest 覆盖**：`lib/store.test.ts`（20 并发 mutate 无丢更新回归）、`restore-source.test.ts`（调度优先级 / 降级 / 警告合并 6 用例）、`register-ipc.test.ts`（通道注册表一致性 + 注册器转发）；离线测试链新增 `test-chat-unpin-input.ts`、`test-godot-detect-project.ts`（8 用例锁住 `project.godot` 解析契约）、`test-inject-splash-version.ts`（9 用例覆盖占位符 / 幂等 / mismatch / checkOnly / 边界 markup）。

### 改进

- **底部工具条重构**：将「模型 / Thinking / 展示思考」三组设置从 TopBar 移到 ChatPanel 底部工具条，与既有的 4 个会话模式 pill（智能体 / 调研 / 计划 / 目标）合并为单行布局；删除原有的 `.composer-mode-bar` 独立行与 `.composer-hint` 提示文案，模式 pill 拆除外层圆角容器改为独立 pill。响应式断点重写：≤1280px 隐藏字段标签、≤900px 模式行独占一行、≤700px 模式 pill 文字隐藏仅图标，统一由 `.composer-actions` 的 `margin-left: auto` 把发送按钮锚到工具条右侧，避免窄屏时「发送」单独换行落到第三行。
- **底部工具条强制两行**：`.composer-toolbar` 改为 grid（`1fr auto` × 2 行，`mode-row` 跨满整行），模式按钮恒占第 1 行、模型设置 + 发送按钮恒占第 2 行，告别「窄屏下发送按钮单独换到第 3 行」的抖动；`composer-model-row` 内部 `flex-wrap: nowrap` 锁住「模型 + Thinking + 展示思考」一行不拆。
- **侧栏 / 工具栏宽度钉死区间**：`SIDEBAR_WIDTH_MAX` 480 → 269、`RIGHT_PANEL_WIDTH_MIN/MAX` 240-640 → 400-507、`RIGHT_PANEL_WIDTH_DEFAULT` 360 → 480 落在新区间内；老 prefs 越界值加载时由 `clampWidth` 自动夹紧。
- **composer-shell 模式色边框**：`.composer-shell` 加 `data-mode` 钩子，按当前会话模式（智能体 / 调研 / 计划 / 目标）映射到 `accent-blue / ctx-messages / ctx-skills / accent-yellow` 四色，与模式 pill 复用同一调色板；默认淡 35% 混合、hover 65%、focus 实色 + 30% box-shadow，当前模式一眼可见。
- **启动页版本号自动注入**：splash.html 静态 `v0.3.12` 易落后版本号；新增 `scripts/inject-splash-version.ts`（`package.json` `predev` / `prebuild` 钩子）从 `version` 字段注入 `v…` 标记，占位符首次替换、后续版本号漂移自动改写、`--check-only` 留给 CI 校验；离线测试 `test-inject-splash-version.ts` 锁住占位符 / 幂等 / mismatch / checkOnly / 边界 markup 9 条契约。
- **ROADMAP 阶段调整**：移除 1.3 跨平台（macOS / Linux）阶段（聚焦 Windows 单一平台），对应调整 1.3 i18n / 1.4 Godot 项目 lint / 1.5 @-补全 / 1.6 E2E 契约锁 编号表述与 mermaid 依赖图；其余验收项不变。

## 0.4.0

### 功能

- **Godot 工具扩展（1.2 全量）**：新增 7 个编辑器工具（Godot 插件 0.5.0）——`godot_get/set_project_setting`（读写 project.godot 配置）、`godot_lint_scripts`（GDScript 静态检查，带行号）、`godot_find_unused_resources`（未使用资源扫描）、`godot_export_project`（headless 子进程出包，不阻塞编辑器）、`godot_get_debugger_state` / `godot_set_breakpoint`（调试器状态与断点，会话启动自动重放）。只读工具进入 Ask / Plan 模式白名单，写型工具计入撤回告警。

### 修复

- **@-补全空白路径误判**：`looksLikePathCandidate` 正则未锚定，`"foo bar"` 等含空白片段被误判为路径候选（该测试曾因未纳入 vitest 而从未运行，0.4.0 激活后暴露）。
- **会话重命名过期提交**：编辑会话名后 120ms 内点击其他会话，会提交过期编辑；现焦点落在会话列表内时跳过提交（onResume 负责切换）。
- **Godot 面板轮询闭包陈旧**：`GodotTab` 轮询依赖缺失导致闭包引用旧 refresh；已 useCallback 化并补全依赖。
- **渲染期写 ref**：`App.tsx` 在渲染函数体内写入 `apiStatusRef`，并发渲染下可能中断；改为 effect 同步。

### 改进

- **依赖全量升级**：Electron 35 → 43、Vite 6 → 7、Vitest 2 → 4、TypeScript 5.9 → 7.0（移除 `baseUrl`，paths 相对化）、electron-vite 3 → 5、`@earendil-works/pi-coding-agent` 0.80 → 0.83（`ModelRuntime.reloadConfig` 迁移到 `refresh()`）；Playwright E2E 在 Electron 43 下通过。
- **死代码清理（0.4.0 梳理）**：删除 7 个无引用文件（`history.ts` / `transcript-mapper.ts` / `SkillSlashMenu` / `skill-slash` / 3 个 barrel index）、约 15 个无消费者导出（`loadPrefsAsync` / `getAllowedPluginRoots` / `syncActiveProfileToPi` 等）、2 条无人调用的 IPC 链路（`activateProviderProfile` / `listSessionSkills`）、preload 6 个 renderer 零使用分面、`syncedActive` 等过期字段。
- **测试体系收敛**：退役 4 组双重覆盖的离线脚本（cwd-sandbox / usage-store / godot-rpc-bridge / shadow-checkpoints），由 Vitest 独占；vitest 纳入 `src/**` 并激活 `at-completion` 测试；补 `project-fs` / `mode-tools` / `mode-prompt` 覆盖（覆盖率 60% 门槛 → 实际 82%+）；删除重复的「重置教程环境.bat」。
- **重复实现收敛**：`THINKING_LEVELS` / `applyTheme` 收敛到单点（`@shared/ipc` / `src/lib/theme.ts`）；`WRITE_PLAN_TOOL` 统一 import 自 `shared/mode-tools.ts`。


### 0.3.x 累计变更

以下为 0.3.0 起各小版本面向用户的说明汇总（新→旧）。

#### 0.3.14

### 功能

- **@ 补全菜单**：聊天输入框输入 `@` 弹出三类候选（技能 / 会话模式 / 文件路径），选中即插入，长列表带键盘导航与排序去重（`useAtCompletion` + `AtMenu`）。
- **Godot 场景内省**：新增 `get_scene_tree` / `get_node_properties` 两个 RPC 方法（Godot 插件 0.4.0），Agent 可直接查看当前场景的节点树与节点属性，为场景级编辑提供上下文。
- **连续工具调用折叠**：同一回合的连续 tool 调用自动折叠为可展开批次，长工具序列不再占满对话；运行中的批次不自动展开，完成后可一键展开 / 收起（`ToolBatch` + `test-tool-batches` 契约锁定）。

### 修复

- **确认弹窗「第一次点击无效果」**：在工具白名单切换等需要 confirm 的场景下，用户快速连续点击切换按钮（或自动批处理、键盘连按等）会让前一次的 await confirm(...) 永远不 resolve —— pendingRef.current 被新调用覆盖，前一次的 resolve 函数丢失，表现为「要点两次确认才生效」。src/lib/app-confirm.tsx 新 confirm 启动前先把旧的 pending resolve 为 false，避免 Promise 泄露。新增 scripts/test-confirm-provider.ts 锁住合约。
- **Godot RPC 断开后无法自动重连**：桥接关闭期间插件每次重连都重置回主端口，fallback 端口（8765–8774）从未被遍历（本机端口无监听是立即 RST，不会走连接超时推进路径），桥接重启后端口 / token 变化时插件永远连不上。插件 0.4.1 重写重连调度：每次重连前重读 endpoint 感知配置变化、同一端口连续重试约 2s 后推进下一候选端口、重连间隔缩短到 0.5s，桥接重启后 0.5–1s 内自动恢复，无需重启编辑器；Godot 设置页同步增加桥接状态轮询，连接 / 断开实时可见。
- **Plan 内联 `<clarify>` 解析**：模型输出带 markdown 包裹的内联 clarify 块时按块边界解析而不是整段吞掉，选项可正常点选发送（`test-plan-clarify` 锁定）。

### 改进

- **Plan 澄清面板重设计**：多题 clarify 选项面板重构选中态 / 间距 / 布局，误触率下降、可见性提升。
- **bash 健康探针 + 设置诊断**：设置页新增 bash 环境诊断，显示 liveness 探测结果与 shell 路径问题，排查更快。
- **工程化 · CI 门槛**：引入 Vitest 单测（node 环境，含 cwd-sandbox / retract-orchestrator / shadow-checkpoints / usage-store / godot-rpc-bridge 关键模块）+ Playwright E2E 基础用例（应用外壳 / 模式切换），CI 增加测试与覆盖率门槛。
- **文档**：新增 `AGENTS.md` 仓库协作入口 + `ROADMAP.md`（1.1 / 1.6 完成标记），开发者与 Agent 上手路径补齐。

#### 0.3.13

### 改进

- **Godot RPC 自动重连**：X-agent 启动时优先复用上次 endpoint 的 token 与端口，已运行的 Godot 插件通常无需任何操作即可在 ~1s 内握手成功（Godot 插件 0.3.0+ 每秒轮询 endpoint 文件 mtime，变更即跳到正确端口）。就绪清单 `rpcBridge` 状态新增 8s 启动宽限；区分「握手失败 → 更新 RPC 插件」与「未连接 → 启动编辑器」，并透出 `lastHandshakeFailure` 与插件版本号。`stop()` 不再删除 endpoint 文件（崩溃 / `taskkill` 路径行为对齐）。0.2.0 旧插件仍能工作，只是不上报 `addonVersion`。
- **调试模式**：开发运行默认打开独立 DevTools；打包版可用 `--x-agent-debug` / `--debug-ui` 或 `X_AGENT_DEBUG=1` 开启，并支持 `F12`、`Ctrl+Shift+I` 切换。
- **启动页**：移除硬编码灰底，改用 `transparent` + HTML 自绘圆角背景，Win11 22H2+ 同时启用 DWM 原生 `roundedCorners`；加载完成 320ms 淡出再 reveal 主窗口，避免视觉跳变。

### 修复

- **长对话消息显示混乱**：对话一旦超过一屏（达到虚拟列表阈值）后，流式追加、assistant 收尾、中间插入 tool 行等路径都出现过行重叠 / 错位。根因是 `ChatTranscript` 在「行数变化」与「status 切换」两个 `useLayoutEffect` 里调用全量 `virtualizer.measure()`，它会清空 tanstack 的整个 `itemSizeCache`，已挂载行全部退回估算高度，长行之后的下一行仍按 estimate 定位造成重叠。现改为依赖新挂载行 ref 实测 + 内部 ResizeObserver 校正，并新增 `test-chat-virtual-cache` 契约测试锁住「禁止全量重测」。
- **气泡 / 工具调用被裁剪**：虚拟行的 `overflow: hidden` 会裁掉连续折叠工具条的紧凑负边距与流式内容，操作头也会被相邻的 transform 行盖住。现改为行盒允许可见溢出，不再为气泡预留布局空间；由行本身按消息顺序反向叠放，并在展开 / 悬停时提升到顶层，让气泡按约定覆盖下方内容；`test-chat-transcript-virtual` 锁住该层叠与溢出契约。
- **Godot RPC 就绪清单离线分支**：原 `bridgeInGrace` 条件在桥接未启动时也会判为「在宽限期」，导致「启动 RPC 桥接」入口漏出。修正后仅当桥接在跑且未超过 8s 才视为宽限内。
- **Godot RPC 端口回退测试**：用 `withIsolatedEndpoint` 隔离 endpoint 文件，避免开发者机器上残留的 endpoint 让端口回退测试改走本机目录。

#### 0.3.12

### 功能

- **更新提示**：安装版静默检查到新版本时不自动下载，应用内提示条「立即更新 / 稍后」并在顶栏显示入口，引导用户按需下载或安装。

### 变更

- **架构 · 主进程 IO 与校验加固**：prefs / usage / provider / auth / godot-rpc 五处持久化改为原子写（tmp + rename），prefs 与 usage 改走 `withStoreLock(path, ...)` 串行化（与 provider 同模式）；safeStorage 不可用时启动一次 probe 并在 UI 横幅告知「密钥以明文存储」；`setPrefs` 走 `ClientPrefsPatchSchema`（`additionalProperties: false`）拒绝未声明字段；`external-url` 显式拒绝 IPv4-mapped IPv6 / link-local / ULA / zone-id；`cwd-sandbox` 与 `plan-tools` 路径前缀比对做 Windows 大小写归一化；`applyBashShellPath` 写入前对 target 做 `--version` 自检。`bash-readonly` / `plan-mode-guard` / `plan-tools` / `goal-evaluator` / `goal-journal` / `session-mode` 6 个废弃入口合并到 `session-mode/*`。
- **UI 拆分**：`PluginsPage`（805 → 90）/ `Sidebar`（528 → 105）拆到 `./plugins/` `./sidebar/` 子目录，顶层只保留壳与 re-export 兼容；`ChatTranscript` virtualizer 配置抽到 `src/lib/chat-transcript-virtual.ts`，5 个 bubble 子组件抽到 `./chat/bubbles.tsx`；`ChatPanel` 拆出 `useSlashMenu` hook 并加 `React.memo` 顶层包装。

### 改进

- **会话模式切换**：智能体 / 调研 / 计划 / 目标四种模式统一使用中文标签，并以蓝 / 青 / 紫 / 黄图标和同色选中态区分；补充 hover、禁用与 `aria-pressed` 状态，保留 `Shift+Tab` 快捷切换。
- **供应商启用约束**：始终保留至少一个启用档案；最后一个启用档案不能被关闭、删除或保存为禁用，设置页会直接解释原因，避免模型列表被清空。
- **发版流程**：本机 `release:dist` 改为可选冒烟；用户下载的权威产物以 CI GitHub Release 为准。
- **工程化**：新增 `apps/desktop/.editorconfig`（UTF-8 / LF / 2 空格缩进 / 去行尾空格 / 末尾换行），停止跟踪 `*.tsbuildinfo`，并将供应商认证缓存回归测试纳入完整测试链。
- **开发文档**：新增 `AGENT.md` 仓库协作指南；同步 `CONTEXT.md` / `CLAUDE.md` 的模块路径与发版约定；补充 Godot TileSet 结构格式调研，并明确本地 ADR / 调研草稿不参与发布。

### 修复

- **prefs 并发丢更新**：`savePrefs` 加 `withStoreLock(path, ...)` 串行化，并发 `patchPrefs` 不再读到同一快照后写覆盖前写；`usage-store` 同步去掉自管 `writeQueue`，统一走 `withStoreLock`。
- **供应商同步与模型过滤**：`providerId` 与 Pi 配置 key 漂移时，按 `baseUrl` 家族回退匹配并清理 `auth.json` / `models.json`，顶栏不再残留已停用模型；启用路径改为静态 ESM 导入，修复打包后切换供应商时的 `Cannot find module`。
- **供应商认证状态缓存**：新增或删除供应商写入 `auth.json` 后主动失效 `checkAuth` 缓存，ReadyChecklist 不再继续误报「未配置供应商」。
- **Windows 发布产物覆盖**：NSIS 安装包与 Portable 便携包使用独立文件名，避免后构建的便携包覆盖安装包，确保 `latest.yml` 的大小与 SHA-512 可用于自动更新校验。

#### 0.3.11

### 修复

- **对话卡顿 + 流式期间无法浏览历史**：流式增量每帧都触发整树 ReactMarkdown 全量重解析 + 强制关闭虚拟化 + 双 rAF 抢回 scrollTop，三者叠加导致长文本流式期间主线程被吃满、用户拖滚动条被强抢。MarkdownBody 在 streaming 时降级到 plain `<pre>`，assistant_end 后一次解析定型；长对话在 streaming 期也走虚拟列表（≥ 24 条）；用 IntersectionObserver 观察尾节点，pinned 才 follow，未 pinned 绝不抢滚动条。

### 改进

- **App / ChatPanel 回调 memo 化**：把传进 ChatPanel / Sidebar 的 inline lambda 全部 `useCallback` 化；TopBar / Sidebar 加 `React.memo`，流式事件不再触发无关组件重渲染。MarkdownBody / UserMessageBody / ToolRow 内部的 `JSON.stringify` / `splitUserMessageFileBlocks` 用 `useMemo` 缓存。

#### 0.3.10

### 功能

- **插件 · 技能开关**：设置 → 插件 → 技能可逐项 / 批量启用或关闭；`disabledSkills` 黑名单持久化，关闭后不进入会话索引与 `/skill` 菜单

### 变更

- **Godot 文档**：移除内置离线文档工具 / 缓存与设置页「官方文档」；改为 `godot-pi` 的 `godot-docs-4-7` 技能（仅 Godot 项目索引）。优化后的 Godot 技能已能很好替代原查询文档能力；基于精简 tool 的原则，去除文档检索工具。
- **godot-pi**：删除细粒度 `godot-*` 惯例技能，统一由文档技能覆盖

### 改进

- **Godot 设置**：页签仅保留编辑器连接与 RPC
- **就绪清单 / 工具白名单**：去掉 Godot 文档工具相关项

### 修复

- **技能页白屏**：旧偏好缺少 `disabledSkills` 时不再崩溃；列表项改为合法 DOM（checkbox 不再嵌在 button 内）

#### 0.3.9

### 修复

- **Ask/Plan bash 硬闸**：按换行切段；拒绝 `$()` / 反引号 / `${}` 命令替换；`godot` / `dotnet` 不再视为只读
- **Goal 预算**：撤回后回滚 `turns` / `tokensUsed`，避免双计；续轮改为 settled 外异步 prompt，避免嵌套竞态
- **会话边界**：`prompt` / `abort` 校验 session bundle epoch，切换/释放会话后不再写错检查点
- **打开项目**：忽略按钮把 `MouseEvent` 当成路径传入导致打开失败
- **Plan 右栏**：切换计划时立即清空旧 markdown，避免短暂串显
- **文件树**：刷新不再并发双 IPC
- **工具卡片**：`tool_update` 在完成后忽略迟到的 partial，避免覆盖最终结果
- **Godot 文档**：选「自定义…」只展开输入，不再立刻用当前分支空调一次

### 改进

- **发送体验**：用户消息乐观气泡（Shadow 检查点完成前即可看见）
- **安全收紧**：Godot RPC method allowlist；外链拒绝本地/私网地址；`will-navigate` 拒绝非本应用 `file:`；`pi install` 跳过 npm lifecycle scripts；单实例锁
- **性能**：流式 `text_delta` / `thinking_delta` 尾部 O(1) 更新；无变化时跳过全量 `history_replace`
- **代码审查**：见 `0.3.8` 之前提交 / `git log --since=2026-08-01`；分诊结论已落入上面各条

#### 0.3.8

### 功能

- **Goal 护栏**：轮次 + token 双预算（`goalMaxTurns` / `goalMaxTokens`）、暂停 / 继续、评估失败自动暂停；日记落盘 `~/.pi/agent/x-agent/goals/`（删会话时清理）
- **Plan / 调研**：bash 只读分类器 + 项目 cwd 路径硬约束；`<clarify>` 多题点选后「发送所选」；计划 todos 勾选；Shift+Tab 循环模式
- **供应商密钥**：`x-agent-providers.json` 尽量用 Electron `safeStorage` 加密（启用时仍写入 Pi `auth.json`）
- **Godot RPC 握手**：endpoint 共享 token，插件 `editor_ready` 校验通过后才接受调用

### 改进

- **顶栏模型**：编辑启用订阅后同步 Pi models；去重 case 变体；下拉仅显示模型名；Thinking / 模型选择居中与首字母大写
- **设置**：目标最大轮次 / token；Shell 说明区分调研·Plan cwd 闸与 Agent 模式
- **文档 / ADR**：Ask·Plan bash 闸门、goals 路径、密钥与 RPC 握手说明；`docs/adr/` 补齐

### 修复

- **Ask/Plan bash**：禁止 python/node 任意执行与 `find -delete` 等突变；拦截目录外路径
- **供应商**：保存已启用档案时避免重复 activate
- **澄清 UI**：由单点即发改为逐题选择后统一发送

#### 0.3.7

### 功能

- **调研模式 (Ask)**：与 Agent / Plan / 目标并列；只读研究与问答（无 `write_plan`）；临时工具集 + 硬闸，不写回设置白名单

### 改进

- **工具设置**：移除「快捷档 / 只读安全档」；临时只读引导至会话「调研」或 Plan；设置页仅控制 Agent/目标默认白名单
- **会话架构**：`SessionModeController` / `RetractOrchestrator` 从 `SessionHost` 拆出；IPC `workspace` / `turn` / `plan` 分面
- **长对话**：聊天转录虚拟列表（`@tanstack/react-virtual`）；SelectMenu 滚动定位更稳

#### 0.3.6

### 功能

- **Plan Mode**：只读研究 + `write_plan`；右栏「计划」可编辑 / 保存到项目；「执行计划」切回 Agent 实施；tool_call 硬闸防误写
- **Goal Mode**：与 Agent / Plan 并列；完成条件 + 独立评估续轮，直至条件满足

### 改进

- **Plan 指令**：system append 注入（不污染用户气泡）；先研究再一次写出完整计划，拒绝 placeholder / 过短 stub；同会话修订覆盖当前计划文件
- **模式切换**：切换 Agent / Plan / Goal 时保留已有计划在右栏，需「清除引用」才丢掉

### 修复

- **工具卡片收起**：结束后强制折叠；修复受控 `<details>` 与 Chromium toggle 抢状态导致卡住展开
- **write_plan 注册**：自定义工具列入 session 白名单；新建会话后正确激活 Plan 工具集

#### 0.3.5

### 功能

- **文件预览 Markdown**：右栏「文件」对 `.md` / `.mdx` / `.markdown` 默认渲染（GFM），可切换源码
- **技能调用可见**：聊天中 `read` 加载 `SKILL.md` 时显示为「技能 · 名称」卡片，而非普通工具

### 改进

- **默认 Thinking 为 high**：更贴合 DeepSeek V4 等仅支持 off/high/max 的模型；打开/新建会话强制应用默认档，并回写钳制后的生效值
- **DeepSeek models.json**：为自定义 id（如 `deepseek-v4-pro[1M]`）补写 `reasoning` / V4 `thinkingLevelMap`，启动时修复缺字段的旧条目，避免 Thinking 被钳成 off
- **引用文件缩略**：发送后的 `<file>` 块在对话与撤回回填输入框中显示为 `@路径` 芯片（可展开）
- **对话吸底跟随**：未上翻时持续跟随最新；仅向上滚动取消跟随，避免布局抖动误取消

### 修复

- **开发环境安装 Godot RPC 插件**：兼容 electron-vite `out/main/chunks` 路径，正确找到仓库内 `packages/godot-editor-rpc`
- **打包版 addon 路径**：优先使用 `extraResources` 内置插件，避免 cwd 落在 monorepo 时误拷开发树

#### 0.3.4

### 功能

- **Shadow Git 工作区撤回**：有本机 Git 时，每轮 prompt 前打独立检查点（`~/.pi/agent/x-agent/checkpoints/`，不写用户 `.git`）；撤回 / 编辑重发优先 `reset` 到该轮 pre，覆盖 write/edit/bash 等 cwd 内改动；无 Git 时仍降级为 write/edit 字节基线
- **撤回确认**：展示还原模式（Shadow / 基线）、可还原路径与风险提示；Godot 仅对会改编辑器状态的工具告警

### 修复

- **检查点绑定时机**：Pi 在 `message_end` 之后才持久化用户消息；改为在 append 之后（`queueMicrotask` / `tool_execution_start`）绑定 active user 与 Shadow pre，避免基线与检查点绑到错误轮次导致「缺少 Shadow / 缺基线」

### 改进

- **测试**：`test-shadow-git`、`test-session-bind-timing`；文档补充撤回 / 检查点路径说明

#### 0.3.3

### 变更

- **移除 Gitee 更新源**：删除设置内更新源切换、发版 CI / `sync-gitee-release` 同步；自动更新仅使用 GitHub Releases
- **就绪清单**：关闭仅本会话隐藏；新增「不再提醒」才对本项目持久关闭 Godot 相关步骤

### 功能

- **更新体验**：打包版启动后静默检查；顶栏更新角标；设置内「打开 Releases」浏览器下载回退
- **偏好恢复**：启动时若 `x-agent.json` 损坏则备份并提示；设置 Escape / `Ctrl+,`；上下文自动压缩阈值；工具「只读安全档」

### 改进

- **设置**：供应商页拆出 `ProvidersSettingsPage`；就绪 / 更新逻辑抽 hook
- **文档**：README 补充安全与隐私说明；Godot 文档导入引导（镜像 / 本地 zip）
- **测试**：prefs recovery、update-feed resolve

#### 0.3.2

### 功能

- **项目就绪清单**：单一可折叠条替代多层横幅（认证 / bash / RPC / Godot 工具 / 文档）；桥接启动有明确反馈，等待连入时可一键启动编辑器
- **空聊天引导**：打开项目后展示 starter prompts，并可跳转 Godot / 设置
- **Godot 工具渐进启用**：桥已连接但工具仍关时提示一键启用
- **主题化确认框**：替换系统 `window.confirm`；warn/danger 默认高亮「取消」

### 改进

- **长会话聊天**：超过阈值时折叠更早消息；流式/长历史时对非尾部气泡降级为纯文本渲染
- **设置分页拆分**：通用 / 工具 / Godot 独立页面组件；Settings 壳层变薄
- **更新与签名说明**：README / CLAUDE / 设置补充 GitHub 自动更新与可选 Windows 代码签名（`CSC_LINK`）
- **工程**：`SessionHost` 拆出 helpers / event-bridge / usage；IPC channel 常量表；`project-fs` 与 Electron shell 解耦；sandbox / ready-checklist / update-feed 测试

#### 0.3.1

### 功能

- **Skill 斜杠菜单**：输入 `/` 弹出当前会话可用技能，筛选并插入 `/skill-name`
- **原生技能包分层**：`godot-pi` 含 Core（`x-*`）与 Godot 技能；非 Godot 项目不索引 `godot-*`；启动时尝试自动安装该包

### 改进

- **godot-pi**：精简大型玩法类默认技能，保留审计 / 场景 / RPC 试玩 / GDScript / 状态机等核心 Godot 技能；新增 `/x-next` 提示
- 设置 → 插件：一键安装文案改为「X-agent 原生技能包」

### 修复

- **聊天滚动**：贴底跟底不再吞掉卸钉；滚轮 / 滚动条 / 触控上翻后可离开底部，避免回弹卡住

#### 0.3.0

### 功能

- **主题化下拉**：自定义 `SelectMenu` 替换原生 `<select>`（顶栏模型 / Thinking、设置内外观与 Godot / 供应商等），下拉面板跟随主题 token
- **发版 minor 汇总**：`0.3.0` 等线起点的 CHANGELOG / GitHub Release 自动纳入上一线（`0.2.0`…`0.2.x`）全部小版本说明

### 改进

- **聊天输入**：一体化 composer 壳（输入 + 发送 / 中止），焦点环包住整块
- **输入框**：全局单行 pill、只读淡化、多行统一圆角与焦点环；Shell 路径等宽
- **设置提示**：供应商 / 通用 / Godot / 插件 / 用量反馈可关闭；成功约 4.5s 自动消失；切页签与关窗清空，避免跨页粘滞

### 开发

- `extract-changelog` / `prepare-release` 支持上一 minor 线汇总；新增 `npm run release:test-changelog`


### 0.2.x 累计变更

以下为 0.2.0 起各小版本面向用户的说明汇总（新→旧）。

#### 0.2.6

### 改进

- **展示思考**：顶栏改为开关式 chip（「展示思考」+ 开/关徽标），开时高亮
- **默认深色**：Surface 加深至 `#141414`，启动窗背景与之对齐
- 空会话去掉 steer 提示；未打开项目时仍提示先选文件夹
- 右栏上下文去掉缓存命中率长脚注，面板更干净

### 修复

- **撤回**：navigate 前预扫变更文件，navigate 后再还原，避免撤回到用户消息时文件状态错乱
- **Godot 文档引用**：回答中用本地 `absPath` 反引号路径，不再改写成 `docs.godotengine.org` 链接

### 开发

- 加深架构接缝：对话实录 `transcript-mapper`、供应商激活、会话标题、cwd 沙箱、Godot / provider / session IPC 注册拆分；`App` 侧事件路由与撤回确认抽 hook

#### 0.2.5

### 功能

- **模型上下文窗口**：供应商档案模型可配置 `contextWindow`，写入 Pi `models.json`；预设 / 拉取 `/v1/models` / 已知模型启发式自动填入（如 DeepSeek V4 → 1M），避免一律按 Pi 默认 128k 计量占用
- **缓存命中率**：右栏上下文与设置 → 用量展示 `cacheRead / (input + cacheRead)`；改工具白名单时确认并提示会重建系统提示、清空本会话前缀缓存

### 改进

- 经 SiliconFlow 等非 `api.deepseek.com` 中转的 DeepSeek 模型，激活时自动写入 Pi `thinkingFormat: deepseek` compat，保证 `reasoning_content` 回传形态正确

### 文档

- `AGENT_CONTEXT` 补充前缀缓存注意点与 `contextWindow` 说明

#### 0.2.4

### 改进

- **Godot 文档搜索**：结果带短摘要（summary）；类页 / 教程标题与排序更准确，概览可少读大 `.rst`
- **文档工具指引**：概览优先用 summary；API 查阅引导 `read(class_*.rst, limit)`

### 修复

- **右栏上下文占用**：按 prompt 侧 `input + cacheRead`（含 trailing 消息）计量，不再把上一轮 output 算进占用条
- **重载插件后工具全开**：`reload` 后重新应用用户工具白名单

### 开发

- 新增 `measure-context-baseline`：对比默认 7 工具与全开 19 工具的基线 token 估量，并纳入 `npm test`

#### 0.2.3

### 功能

- **多风格 GUI 主题**：设置 → 通用可选默认 / Nord / Tokyo Night / Warm Paper / High Contrast；顶栏仍切换深浅；偏好为 `themeId` + `colorMode`（兼容旧 `theme` / `cindy`）
- **应用图标**：窗口 / 安装包 / 网页 favicon 使用统一品牌图标
- **顶栏紧凑布局**：窄窗时隐藏部分文案，保留图标与 title

### 改进

- 窗口最小尺寸下调，并隐藏应用菜单栏
- 侧栏 / 右栏在窗口缩小时自动让出聊天区宽度

### 文档

- DESIGN 补充主题族与可变样式令牌说明
- 同步 README / CLAUDE / AGENT_CONTEXT 与 0.2.x 能力说明；修正 Godot 设置入口文案

#### 0.2.2

### 修复

- **CI / 发版测试**：`test-turn-file-tracker` 补上缺失的 `unlinkSync` 导入（symlink 用例在 Windows runner 上可用时不再 ReferenceError）

#### 0.2.1

### 功能

- **会话用量与上下文面板**：右栏「上下文」展示占用进度、组成拆解（含协议损耗）、本轮 / 会话累计用量；支持手动压缩上下文
- **用量设置**：设置 → 用量，查看本地按日 / 按模型汇总，可清空统计
- **技能加载**：不再自动加载 `~/.agents/skills`，避免无关技能索引膨胀上下文

### 修复

- **组成拆解**：API 占用与文本估算的差额单独记为「协议损耗」，不再并入系统提示

#### 0.2.0

### 功能

- **Godot 官方文档离线检索**：设置 → Godot →「官方文档」选择分支、打开下载链接并导入源码 zip；Agent 工具 `godot_docs_search` / `godot_docs_status`（默认关闭）
- **设置页整理**：Godot 拆成「编辑器连接 / 官方文档」子页签；通用 / 工具等分区卡片化；左侧导航带图标
- **工具分组一键开关**：启用工具各分组可用图标按钮整组开启 / 关闭

### 修复

- **新会话输入框偶发卡死**：切换 / 新建 / 恢复会话时清除编辑态，避免误锁输入
- **文档检索后读错路径**：搜索结果提供 `absPath`，并引导用 `read` 读本地缓存而非项目内 docs
- **Packages 安装区异常渐变**：供应商页 sticky 渐变不再误套到插件 Packages 面板
