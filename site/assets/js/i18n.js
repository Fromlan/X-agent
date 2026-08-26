/* i18n.js — bilingual (中文 / English) dictionary + switcher
 * No framework; data-i18n="key" attributes get textContent replaced.
 */

const I18N = {
  zh: {
    // meta
    "meta.title": "X-agent — Godot 4 项目的桌面编码 Agent",
    "meta.description":
      "X-agent 是一款基于 Pi SDK 的 Godot 4 桌面编码 Agent：同会话里改代码、跑场景、撤回到任意一步。",
    "meta.ogDescription":
      "Godot 4 项目的桌面编码 Agent：同会话里改代码、跑场景、撤回到任意一步。",

    // topbar
    "nav.product": "产品",
    "nav.modes": "模式",
    "nav.roles": "场景",
    "nav.timeline": "能力",
    "nav.faq": "FAQ",
    "cta.download": "下载",
    "cta.theme.toggle": "切换主题",

    // hero
    "hero.status": "Early Beta · ",
    "hero.title": "X-agent",
    "hero.sub":
      "为 Godot 4 而生的桌面编码 Agent — 在同一会话里改代码、跑场景、撤回到任意一步,17 个 Godot 工具与 Shadow Git 撤回始终待命。",
    "cta.downloadWin": "下载 Windows 安装包",
    "cta.star": "GitHub Star",
    "cta.readme": "看 README",

    "hero.scrollHint": "滚动",

    // pillars
    "pillars.eyebrow": "WHY X-AGENT",
    "pillars.title": "三件其他 Agent 没做好的事",
    "pillars.sub":
      "每个支柱都链到 docs/agent.md 的详细机制；下面这些差异在 30 秒上手里就能感受到。",

    "pillar.godot.title": "Godot 深度联动",
    "pillar.godot.lede":
      "Agent 直接驱动你的 Godot 编辑器：开/重载场景、跑当前或主场景、跑完收集报错回传。",
    "pillar.godot.l1": "<span class=\"card__list-key\">编辑器 RPC (TCP)</span><span class=\"card__list-desc\">默认 8765，多编辑器显式选路</span>",
    "pillar.godot.l2": "<span class=\"card__list-key\">17 个 Godot 工具</span><span class=\"card__list-desc\">场景内省 / 调试器 / 资源治理 / 导出 / 配置读写</span>",
    "pillar.godot.l3": "<span class=\"card__list-key\">godot-docs-4-7 技能</span><span class=\"card__list-desc\">Pi 按需 read，0 token 浪费</span>",
    "pillar.godot.l4": "<span class=\"card__list-key\">就绪清单</span><span class=\"card__list-desc\">首次开 Godot 项目一键引导</span>",

    "pillar.rewind.title": "可信任的撤回",
    "pillar.rewind.lede":
      "Shadow Git 检查点（独立于你的 .git），按 diff 路径还原，撤回前先看 diff。",
    "pillar.rewind.l1": "<span class=\"card__list-key\">Shadow Git</span><span class=\"card__list-desc\">每轮 prompt 前打独立检查点</span>",
    "pillar.rewind.l2": "<span class=\"card__list-key\">Diff 预览</span><span class=\"card__list-desc\">撤回前逐行确认影响范围</span>",
    "pillar.rewind.l3": "<span class=\"card__list-key\">断点不重写</span><span class=\"card__list-desc\">跨恢复不丢 Shadow 状态</span>",
    "pillar.rewind.l4": "<span class=\"card__list-key\">无 Git 降级</span><span class=\"card__list-desc\">write/edit 字节基线仍能 diff</span>",

    "pillar.modes.title": "4 模式 + 2 类型硬闸",
    "pillar.modes.lede":
      "会话模式决定可用工具；会话类型决定写操作作用域。两条独立，组合出 8 种工作流。",
    "pillar.modes.l1": "<span class=\"card__list-key\">Agent / 调研 / 计划 / 目标</span><span class=\"card__list-desc\">互斥切换</span>",
    "pillar.modes.l2": "<span class=\"card__list-key\">code / design</span><span class=\"card__list-desc\">写操作作用域独立维度</span>",
    "pillar.modes.l3": "<span class=\"card__list-key\">硬闸在 IPC 层</span><span class=\"card__list-desc\">UI 被攻陷也绕不过</span>",
    "pillar.modes.l4": "<span class=\"card__list-key\">0 token 浪费</span><span class=\"card__list-desc\">切换不重写 system prompt</span>",

    // modes
    "modes.eyebrow": "4 模式 × 2 类型",
    "modes.title": "互斥模式 × 正交类型",
    "modes.sub": "会话模式决定能用哪些工具，会话类型决定写操作落到哪里。",
    "modes.row.modes": "模式",
    "modes.row.types": "类型",
    "modes.mode.agent": "Agent",
    "modes.mode.ask": "调研",
    "modes.mode.plan": "计划",
    "modes.mode.goal": "目标",
    "modes.type.code": "code",
    "modes.type.design": "design",

    // roles
    "roles.eyebrow": "你要用 X-agent 做什么",
    "roles.title": "四个常见场景，按\"我是什么角色\"选",
    "roles.sub": "下面是按角色预热好的典型流程；具体 prompt 在 30 秒上手里。",

    "role.dev.title": "🎮 Godot 开发者 · 改代码 + 跑场景",
    "role.dev.step": "流程 4 步",
    "role.dev.body":
      "打开项目 → Agent 模式 → 选模型 → 问\"在 Player.gd 加冲刺功能，跑一下当前场景\"。",
    "role.dev.flow.0": "打开项目",
    "role.dev.flow.1": "Agent 模式",
    "role.dev.flow.2": "改文件",
    "role.dev.flow.3": "RPC 重载",
    "role.dev.flow.4": "跑场景",
    "role.dev.flow.5": "报错回传",

    "role.designer.title": "✍️ 独立策划 · 写设计文档（不污染 game/）",
    "role.designer.step": "流程 3 步",
    "role.designer.body":
      "新会话选 design 类型 → 写只允许落到 &lt;cwd&gt;/game-design/ → 预装 5 个 design skill 帮你做立项 / 数值 / 核心循环。",
    "role.designer.flow.0": "选 design 类型",
    "role.designer.flow.1": "读预装 skill",
    "role.designer.flow.2": "写到 game-design/",

    "role.research.title": "🔬 研究只读 · 问 API、查文档",
    "role.research.step": "流程 2 步",
    "role.research.body":
      "切调研模式 → write / edit 硬闸关 → bash 仅放行只读命令，路径须在项目 cwd 内。",
    "role.research.flow.0": "切调研模式",
    "role.research.flow.1": "只读问答",

    "role.goal.title": "🎯 目标驱动 · 让 Agent 自己跑到完成",
    "role.goal.step": "流程 3 步",
    "role.goal.body":
      "切目标模式 → 写完成条件（如\"在 ScoreManager.gd 加 combo 计数 + HUD 显示\"） → 评估未达自动续轮。",
    "role.goal.flow.0": "切目标模式",
    "role.goal.flow.1": "写完成条件",
    "role.goal.flow.2": "评估续轮",

    // timeline
    "timeline.eyebrow": "关键能力",
    "timeline.title": "版本时间线 · 最新在上",
    "timeline.sub": "完整列表见 CHANGELOG.md。",
    "timeline.v055.title":
      "<b>策划会话 design 类型</b> — 写只允许落到 &lt;cwd&gt;/game-design/，UI 切暖色主题",
    "timeline.v055.skills":
      "<b>5 个内置 design skill</b> — 立项 / 流程 / 系统 / 数值 / 核心循环懒写即用",
    "timeline.v054.title":
      "<b>v1.1 elevation 设计语言</b> — Composer 唯一主元素，三栏降为低调 chrome",
    "timeline.v053.title":
      "<b>Diff 显示</b> — 撤回前 +/- 着色 diff，带 +N / -N 统计",
    "timeline.v052.title":
      "<b>thinking-orbs 状态行动画</b> — 运行中粒子轨道而非转圈",
    "timeline.v04x.git": "<b>Shadow Git 撤回</b> — 每轮检查点，按 diff 路径还原",
    "timeline.v04x.docs":
      "<b>godot-docs-4-7</b> — 引擎惯例技能，按需 read",
    "timeline.v036.title":
      "<b>4 模式 + 2 类型硬闸</b> — Agent / 调研 / 计划 / 目标 × code / design",
    "timeline.v025.title":
      "<b>Thinking 档位 + 模型钳制</b> — DeepSeek 等自动钳制，编辑器实时反馈",
    "timeline.more": "查看完整 CHANGELOG",

    // faq
    "faq.eyebrow": "常见问题",
    "faq.title": "6 个装之前最常问的",
    "faq.q1": "在线 / 离线能用吗？",
    "faq.a1":
      "<p>模型调用走 API（在线）；本地用量 / 检查点 / 会话 / 撤回全部离线。</p><p>Godot 文档技能 godot-docs-4-7 在 Godot 项目内自动索引。</p>",
    "faq.q2": "为什么不用 VS Code + Copilot？",
    "faq.a2":
      "<p>1) Godot 编辑器 RPC 联动（场景内省 / 调试器 / 资源治理）VS Code 插件做不到；</p><p>2) Shadow Git 撤回独立于你的 .git（VS Code 不会按 diff 路径还原）；</p><p>3) 4 模式 + 2 类型硬闸（VS Code 插件是建议，X-agent 是 IPC 层强制）。</p>",
    "faq.q3": "可以用在非 Godot 项目吗？",
    "faq.a3":
      "<p>可以（IDE 本身是 Electron + Pi SDK 通用），但 Godot 工具全部关掉就退化成普通 Agent，<b>没有差异化价值</b>。</p>",
    "faq.q4": "数据会同步到云吗？",
    "faq.a4":
      "<p>不会。本机持久化（~/.pi/agent/）。仅模型调用走你配置的 provider。</p>",
    "faq.q5": "升级会丢数据吗？",
    "faq.a5":
      "<p>不会。升级保留 ~/.pi/agent/ 下所有内容。如需回滚到旧版，直接装旧 installer 覆盖。</p>",
    "faq.q6": "macOS / Linux 呢？",
    "faq.a6":
      "<p>当前 0.5.5 仅 Windows。Phase 3.4 路线图里有 macOS / Linux 安装包（详见 docs/roadmap.md）。</p>",

    // footer
    "footer.about":
      "X-agent — Godot 4 项目的桌面编码 Agent。基于 Pi SDK。",
    "footer.col.project": "项目",
    "footer.col.docs": "文档",
    "footer.col.contact": "联系",
    "footer.link.repo": "GitHub 仓库",
    "footer.link.releases": "Releases",
    "footer.link.issues": "Issues",
    "footer.link.agent": "开发文档",
    "footer.link.roadmap": "路线图",
    "footer.link.changelog": "CHANGELOG",
    "footer.link.readme": "README",
    "footer.contact.email": "fromlan@qq.com",
    "footer.contact.qq": "QQ 群 1074500101",
    "footer.bottom":
      "© 2026 Fromlan · MIT License · Windows 10/11 · Godot 4.x",

    // language switcher
    "lang.zh": "中",
    "lang.en": "EN",
  },

  en: {
    // meta
    "meta.title": "X-agent — a desktop coding agent for Godot 4 projects",
    "meta.description":
      "X-agent is a Godot 4 desktop coding agent built on the Pi SDK: edit code, run scenes, and rewind to any step—all in the same session.",
    "meta.ogDescription":
      "A desktop coding agent for Godot 4: edit code, run scenes, and rewind to any step—all in the same session.",

    // topbar
    "nav.product": "Product",
    "nav.modes": "Modes",
    "nav.roles": "Use cases",
    "nav.timeline": "Changelog",
    "nav.faq": "FAQ",
    "cta.download": "Download",
    "cta.theme.toggle": "Toggle theme",

    // hero
    "hero.status": "Early Beta · ",
    "hero.title": "X-agent",
    "hero.sub":
      "A desktop coding agent built for Godot 4 — edit code, run scenes, and rewind to any step in the same session, with 17 Godot tools and Shadow Git rollback on standby.",
    "cta.downloadWin": "Download for Windows",
    "cta.star": "Star on GitHub",
    "cta.readme": "Read the README",

    "hero.scrollHint": "scroll",

    // pillars
    "pillars.eyebrow": "WHY X-AGENT",
    "pillars.title": "Three things no other agent does well",
    "pillars.sub":
      "Each pillar links to the detailed mechanism in docs/agent.md. You'll feel the difference within 30 seconds.",

    "pillar.godot.title": "Deep Godot integration",
    "pillar.godot.lede":
      "The agent drives your running Godot editor: open / reload scenes, run current or main scene, capture play errors and stream them back.",
    "pillar.godot.l1": "<span class=\"card__list-key\">Editor RPC (TCP)</span><span class=\"card__list-desc\">default 8765, explicit multi-editor routing</span>",
    "pillar.godot.l2": "<span class=\"card__list-key\">17 Godot tools</span><span class=\"card__list-desc\">scene introspection / debugger / resource hygiene / export / config R/W</span>",
    "pillar.godot.l3": "<span class=\"card__list-key\">godot-docs-4-7 skill</span><span class=\"card__list-desc\">loaded on demand by Pi, 0 wasted tokens</span>",
    "pillar.godot.l4": "<span class=\"card__list-key\">Ready checklist</span><span class=\"card__list-desc\">first-run wizard for Godot projects</span>",

    "pillar.rewind.title": "Trustworthy rollback",
    "pillar.rewind.lede":
      "Shadow Git checkpoints (isolated from your .git). Restore by diff path; preview the diff before you rewind.",
    "pillar.rewind.l1": "<span class=\"card__list-key\">Shadow Git</span><span class=\"card__list-desc\">one checkpoint per prompt, isolated from your .git</span>",
    "pillar.rewind.l2": "<span class=\"card__list-key\">Diff preview</span><span class=\"card__list-desc\">line-by-line confirmation before rewind</span>",
    "pillar.rewind.l3": "<span class=\"card__list-key\">Survives restarts</span><span class=\"card__list-desc\">Shadow state persists across session restore</span>",
    "pillar.rewind.l4": "<span class=\"card__list-key\">No-Git fallback</span><span class=\"card__list-desc\">write/edit byte baseline still produces diffs</span>",

    "pillar.modes.title": "4 modes × 2 types, hard-gated",
    "pillar.modes.lede":
      "Session mode picks the tool allowlist; session type picks the write scope. Two independent axes, 8 workflows.",
    "pillar.modes.l1": "<span class=\"card__list-key\">Agent / Ask / Plan / Goal</span><span class=\"card__list-desc\">mutually exclusive</span>",
    "pillar.modes.l2": "<span class=\"card__list-key\">code / design</span><span class=\"card__list-desc\">orthogonal write-scope axis</span>",
    "pillar.modes.l3": "<span class=\"card__list-key\">Hard-gate at the IPC layer</span><span class=\"card__list-desc\">UI compromise cannot bypass</span>",
    "pillar.modes.l4": "<span class=\"card__list-key\">0 wasted tokens</span><span class=\"card__list-desc\">switching does not rewrite the system prompt</span>",

    // modes
    "modes.eyebrow": "4 modes × 2 types",
    "modes.title": "Mutually exclusive modes × orthogonal types",
    "modes.sub":
      "Mode picks the tool allowlist; type picks where writes land.",
    "modes.row.modes": "Modes",
    "modes.row.types": "Types",
    "modes.mode.agent": "Agent",
    "modes.mode.ask": "Ask",
    "modes.mode.plan": "Plan",
    "modes.mode.goal": "Goal",
    "modes.type.code": "code",
    "modes.type.design": "design",

    // roles
    "roles.eyebrow": "What will you do with X-agent?",
    "roles.title": "Four common scenarios — pick by role",
    "roles.sub":
      "Typical flows pre-warmed by role. Find the prompt that fits in the 30-second quick start.",

    "role.dev.title": "🎮 Godot developer · edit code + run scenes",
    "role.dev.step": "4 steps",
    "role.dev.body":
      "Open project → Agent mode → pick a model → ask: \"add a dash to Player.gd and run the current scene.\"",
    "role.dev.flow.0": "Open project",
    "role.dev.flow.1": "Agent mode",
    "role.dev.flow.2": "Edit file",
    "role.dev.flow.3": "RPC reload",
    "role.dev.flow.4": "Run scene",
    "role.dev.flow.5": "Errors stream back",

    "role.designer.title": "✍️ Solo designer · write design docs (keep game/ clean)",
    "role.designer.step": "3 steps",
    "role.designer.body":
      "Pick design session type → writes are hard-confined to &lt;cwd&gt;/game-design/ → 5 preinstalled design skills help with initiation / numbers / core loop.",
    "role.designer.flow.0": "Pick design type",
    "role.designer.flow.1": "Read preinstalled skill",
    "role.designer.flow.2": "Write to game-design/",

    "role.research.title": "🔬 Read-only research · ask APIs, look up docs",
    "role.research.step": "2 steps",
    "role.research.body":
      "Switch to Ask mode → write / edit hard-closed → bash only allows read-only commands; paths must stay inside the project cwd.",
    "role.research.flow.0": "Switch to Ask mode",
    "role.research.flow.1": "Read-only Q&A",

    "role.goal.title": "🎯 Goal-driven · let the agent run until the goal is met",
    "role.goal.step": "3 steps",
    "role.goal.body":
      "Switch to Goal mode → set a completion condition (e.g. \"add combo counter to ScoreManager.gd + show on HUD\") → evaluator auto-continues while unmet.",
    "role.goal.flow.0": "Switch to Goal mode",
    "role.goal.flow.1": "Set completion condition",
    "role.goal.flow.2": "Evaluator continues",

    // timeline
    "timeline.eyebrow": "Key capabilities",
    "timeline.title": "Release timeline · newest first",
    "timeline.sub": "Full list in CHANGELOG.md.",
    "timeline.v055.title":
      "<b>Design session type</b> — writes hard-confined to &lt;cwd&gt;/game-design/, warm theme UI",
    "timeline.v055.skills":
      "<b>5 preinstalled design skills</b> — initiation / process / systems / numerical / core loop, ready to use",
    "timeline.v054.title":
      "<b>v1.1 elevation design language</b> — Composer as the single main element; chrome steps back",
    "timeline.v053.title":
      "<b>Diff display</b> — +/- colored diff before rewind, with +N / -N stats",
    "timeline.v052.title":
      "<b>thinking-orbs status animation</b> — particle-orbit while running, not a spinner",
    "timeline.v04x.git": "<b>Shadow Git rollback</b> — per-turn checkpoints, restore by diff path",
    "timeline.v04x.docs":
      "<b>godot-docs-4-7</b> — engine-conventions skill, loaded on demand",
    "timeline.v036.title":
      "<b>4 modes × 2 types hard-gate</b> — Agent / Ask / Plan / Goal × code / design",
    "timeline.v025.title":
      "<b>Thinking levels + model clamp</b> — auto-clamp for DeepSeek etc., live editor feedback",
    "timeline.more": "View full CHANGELOG",

    // faq
    "faq.eyebrow": "FAQ",
    "faq.title": "6 things people ask before installing",
    "faq.q1": "Does it work offline?",
    "faq.a1":
      "<p>Model calls need API (online); local usage / checkpoints / sessions / rollback are fully offline.</p><p>The Godot docs skill godot-docs-4-7 is auto-indexed inside Godot projects.</p>",
    "faq.q2": "Why not just VS Code + Copilot?",
    "faq.a2":
      "<p>1) Godot editor RPC integration (scene introspection / debugger / resource hygiene) is out of reach for VS Code plugins.</p><p>2) Shadow Git rollback is isolated from your .git (VS Code doesn't restore by diff path).</p><p>3) 4 modes × 2 types are enforced at the IPC layer, not just suggested.</p>",
    "faq.q3": "Can I use it for non-Godot projects?",
    "faq.a3":
      "<p>Technically yes (the IDE is Electron + Pi SDK, generic), but with all Godot tools off it degrades to a plain agent—<b>no differentiation value</b>.</p>",
    "faq.q4": "Does my data sync to the cloud?",
    "faq.a4":
      "<p>No. Everything is local (~/.pi/agent/). Only model calls go through your configured provider.</p>",
    "faq.q5": "Will upgrades wipe my data?",
    "faq.a5":
      "<p>No. Upgrades preserve everything under ~/.pi/agent/. To roll back, install an older installer over the current one.</p>",
    "faq.q6": "What about macOS / Linux?",
    "faq.a6":
      "<p>0.5.5 is Windows-only. Phase 3.4 of the roadmap includes macOS / Linux installers (see docs/roadmap.md).</p>",

    // footer
    "footer.about":
      "X-agent — a desktop coding agent for Godot 4 projects. Built on the Pi SDK.",
    "footer.col.project": "Project",
    "footer.col.docs": "Docs",
    "footer.col.contact": "Contact",
    "footer.link.repo": "GitHub repo",
    "footer.link.releases": "Releases",
    "footer.link.issues": "Issues",
    "footer.link.agent": "Dev docs",
    "footer.link.roadmap": "Roadmap",
    "footer.link.changelog": "CHANGELOG",
    "footer.link.readme": "README",
    "footer.contact.email": "fromlan@qq.com",
    "footer.contact.qq": "QQ group 1074500101",
    "footer.bottom":
      "© 2026 Fromlan · MIT License · Windows 10/11 · Godot 4.x",

    // language switcher
    "lang.zh": "中",
    "lang.en": "EN",
  },
};

const LOCALE_KEY = "x-agent-site-locale";

function getInitialLocale() {
  try {
    const saved = localStorage.getItem(LOCALE_KEY);
    if (saved === "zh" || saved === "en") return saved;
  } catch (e) {
    /* localStorage unavailable */
  }
  // Default: Chinese (project is Chinese-first; README.md is the primary)
  return "zh";
}

let currentLocale = getInitialLocale();

function t(key) {
  const dict = I18N[currentLocale] || I18N.zh;
  return dict[key] !== undefined ? dict[key] : I18N.zh[key] || key;
}

function applyLocale(locale) {
  currentLocale = locale === "en" ? "en" : "zh";
  try {
    localStorage.setItem(LOCALE_KEY, currentLocale);
  } catch (e) {
    /* ignore */
  }
  document.documentElement.lang = currentLocale === "en" ? "en" : "zh-CN";

  // Update <title> and meta
  const titleEl = document.querySelector("title[data-i18n]");
  if (titleEl) titleEl.textContent = t("meta.title");
  const descEl = document.querySelector('meta[name="description"]');
  if (descEl) descEl.setAttribute("content", t("meta.description"));
  const ogDescEl = document.querySelector('meta[property="og:description"]');
  if (ogDescEl) ogDescEl.setAttribute("content", t("meta.ogDescription"));

  // Update all data-i18n text nodes
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });

  // Update all data-i18n-html (allow inline HTML for rich content like <b>)
  document.querySelectorAll("[data-i18n-html]").forEach((el) => {
    const key = el.getAttribute("data-i18n-html");
    const val = t(key);
    if (val !== undefined) el.innerHTML = val;
  });

  // Update language switcher state
  document.querySelectorAll("[data-lang-switch]").forEach((btn) => {
    const target = btn.getAttribute("data-lang-switch");
    btn.setAttribute("aria-pressed", target === currentLocale ? "true" : "false");
  });
}

function initLocale() {
  applyLocale(currentLocale);
}

// Expose for theme.js / release.js / inline handlers
window.XAgentI18n = { t, applyLocale, get currentLocale() { return currentLocale; } };
