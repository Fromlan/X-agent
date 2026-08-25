/**
 * Builtin design skills — 5 个策划专用 skill, 懒写到 Pi 标准 user skill 路径
 * `~/.pi/agent/skills/design-{id}/SKILL.md` 让 Pi 的 `DefaultResourceLoader` 自动发现.
 *
 * 关键设计:body **不**预注入 system prompt; agent 通过 `read` 工具按需读全文.
 * `<available_skills>` 索引只暴露 frontmatter (name + description).
 *
 * 触发时机:
 * - `electron/agent/builtin-skills-installer.ts` (singleton + mutex)
 *   - main 进程启动时 fire-and-forget 预热
 *   - 每个 session start 后 fire-and-forget 兜底
 *
 * 用户自定义保护:首次 install 后记录 sha256 到
 * `~/.pi/agent/x-agent/builtin-skills-installed.json`;若磁盘 SKILL.md sha256 不在
 * 记录里(说明用户改过),跳过 install 不覆盖. 只有显式 `force: true` 才覆盖.
 */
import { createHash, randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { homedir } from "os";
import { posix as path } from "path";

/** 默认 Pi agent 根目录: 复用项目约定的 ~/.pi/agent. 测试可注入. */
export function defaultAgentDirPath(): string {
  return path.join(homedir(), ".pi", "agent");
}

/** 单条 BUILTIN skill 的 source-of-truth 定义. */
export type DesignBuiltinSkill = {
  /** 目录名 + frontmatter name + `<available_skills>` 名字, 全小写、连字符分隔. */
  id: string;
  /** 人类可读标签 (frontmatter name 直接复用). */
  name: string;
  /** frontmatter description, 1..240 字符 (Pi 校验 headroom 1024). */
  description: string;
  /** 完整 markdown body (200..2400 字符), 仅在 agent `read` SKILL.md 时进 context. */
  body: string;
};

// ===== 5 条 BUILTIN 常量 =====

const SKILL_INITIATION: DesignBuiltinSkill = {
  id: "design-initiation",
  name: "design-initiation",
  description:
    "游戏立项策划：从模糊创意到 GDD / 原型清单 / 批判性分析的完整工作坊. 触发：用户提新游戏想法、要做立项评估、问 GDD 怎么写.",
  body: `# 游戏立项策划工作坊

把抽象游戏灵感转成可执行开发蓝图. 6 步固定流程,产物落到 \`<cwd>/game-design/\` 三个独立文档.

## 步骤

### 1. 理解初始创意 (1 句)
用户给出想法后,1-2 句话总结你对游戏类型/主题/初步玩法的理解,确认方向正确.

### 2. 核心探索 Q&A (5 个优先级)
- 一句话描述 (Elevator Pitch)
- 30s 核心玩法循环
- 乐趣来源 (策略/操作/探索/叙事)
- 独特卖点 USP
- 灵感来源与 3-5 款对标作品

一次只问 1-2 个,严禁问细节(数值/UI/图标). 战略问题(平台/竞品/受众)可以问.

### 3. 范围与可行性自评
- MVP 范围 (1-3 月可玩的最小集合)
- 砍功能清单 (多人/复杂装备/海量关卡/过场动画)
- 技能自评 (程序/美术/音乐/策划/文案 五维: 精通/熟练/了解/零基础)
- 每周可投入小时 + 主要风险

### 4. 写入 GDD 初稿
**路径**: \`<cwd>/game-design/gdd-{游戏名}.md\`

必含 9 段:游戏概述 / 核心玩法 / USP 与竞品 / 受众与情感 / 系统设计 / 内容规划 / 技术概要 / 项目范围 / 阶段规划.

具体系统(角色/关卡/经济)由你基于核心玩法**逻辑推导**填充,不要追问用户琐碎细节.

### 5. 写入原型制作清单
**路径**: \`<cwd>/game-design/prototype-{游戏名}.md\`

只列验证核心玩法循环所必需的最小功能集. 严守 MVP 边界. 必须**明确列出**原型阶段不做的 10 项(精美美术/音效/UI 精美/剧情/新手引导/付费/存档/性能优化/多语言/过场).

### 6. 写入批判性分析
**路径**: \`<cwd>/game-design/critique-{游戏名}.md\`

按 6 维度评估: 创新性 / 可玩性 / 市场潜力 / 设计风险 / 范围风险 / 技能匹配度.

每个负面评价必须附改进建议. 最后给 1-10 综合可行性评分 + 三选一立项建议:
- ✅ 建议立项
- ⚠️ 需调整方案后重新评估
- ❌ 建议暂缓,条件不成熟

## 硬约束

1. 产出即文件,三份文档必须写到磁盘
2. 顺序固定: Q&A → 自评 → GDD → 原型 → 批判
3. 文件名用游戏暂定名 (小写英文或拼音, 连字符分隔)
4. 系统细节逻辑推导,不追问用户

## Godot 适配

技术概要默认推荐 Godot 引擎, 提及 CharacterBody2D / Area2D 等节点.
`,
};

const SKILL_PROCESS: DesignBuiltinSkill = {
  id: "design-process",
  name: "design-process",
  description:
    "游戏开发流程纪律：5 阶段边界 + 想法池 + 设计/代码分离 + 周节奏. 触发：用户问下一步做什么、项目阶段混乱、出现边写边改、设计与代码互相污染.",
  body: `# 健康游戏开发流程

适合个人或小团队. 重点是把 **设计决策** 和 **代码实现** 分开.

## 一、5 个阶段边界

### 1. 概念阶段
只写一页纸:
- 核心体验 (e.g. \"爽快的平台跳跃\")
- 目标平台
- 参考游戏 (2-3 款)
- **不做清单** (本期明确不做的)

### 2. 预制作 / 原型阶段
用最快最脏的代码验证核心玩法:
- 允许混乱,只限一个原型项目
- 不写正式架构、不做美术 UI 存档
- 只验证一个核心问题: **这个玩法有没有趣?**

如果原型不好玩 → 改设计,不要改正式代码 (因为还没有正式代码).

### 3. 垂直切片阶段
做一个完整可玩小片段 (一关/一场战斗):
- 含基础美术 / 音效 / UI / 代码结构
- 验证完整流程是否成立
- 结束后核心设计基本冻结

### 4. 量产阶段
按模块填充内容 (更多关卡/敌人/道具):
- 不再轻易动核心设计
- 只做内容增加和局部优化
- 所有新想法进入想法池, 不立即实现

### 5. 打磨阶段
只修 bug、调数值、优化体验:
- 禁止新增功能
- 设计修改只限于数值调整
- 重点做玩家测试和稳定性

## 二、设计变更入口

所有设计想法先记录到 **想法池** (Notion/Obsidian/Trello/txt 均可).

想到任何改动 → 先写进想法池, **不要立刻改代码**.

每周五下午 30 分钟评审: 每个想法三选一:
- 现在做 → 进入下周任务
- 以后做 → 留在池子里
- 不做 → 删掉或标废弃

**决定做之后的流程**:
1. 更新设计文档 / 配置表
2. 创建代码任务
3. 写代码
4. 测试

先改代码再补文档 = 文档与代码脱节,后面越来越乱.

## 三、代码层和设计层分离

### 能配置的数值不要硬编码
跳跃高度/移速/伤害/血量/掉落率全部放配置 (json/tres):
\`\`\`json
{ "jumpHeight": 2.5, "moveSpeed": 6.0, "playerMaxHp": 100 }
\`\`\`
调手感时只改配置,不改核心代码.

### 模块边界清晰
不要在一个脚本里同时处理移动/伤害/UI/存档. 拆系统:
- 移动系统
- 战斗系统
- 存档系统
- UI 系统

## 四、每周节奏

- 周一: 确定本周目标, 从想法池挑选, 冻结本周设计
- 周二~周四: 只写代码/美术, 按任务卡执行, 不临时加新设计
- 周五: 测试、回顾, 收集新想法放入想法池, 不立即实现
- 周末: 休息, 远离项目

## 五、自救流程 (项目已经混乱)

按顺序做,不要急着重构:

1. **停止新增功能** — 先不要再加任何新东西
2. **让当前版本能跑起来** — 确保有一个可运行的游戏版本, 哪怕不完整
3. **写一页\"当前真实设计\"** — 把代码里实际实现的设计记录下来 (代码里现在真正有的东西, 不是理想设计)
4. **列出\"不确定设计清单\"** — 反复修改没定下来的设计 = 混乱源头
5. **从下一个功能开始执行流程** — 不回头重构所有东西, 只保证新功能按流程走, 旧代码慢慢再整理

## 核心三句话

1. **设计先行** — 先确定要做什么, 再写代码
2. **变更受控** — 所有设计修改先进想法池, 评审后再进代码
3. **小步验证** — 用原型和垂直切片尽早发现设计问题, 避免在量产阶段大改
`,
};

const SKILL_SYSTEMS: DesignBuiltinSkill = {
  id: "design-systems",
  name: "design-systems",
  description:
    "游戏系统设计三件套：角色三视图 / 世界观框架 / 关卡机制. 触发：用户要设计角色、世界观、关卡等可玩系统层资产.",
  body: `# 游戏系统设计

覆盖策划会话最常写的 3 类系统层文档. 每类都有固定骨架,先扫 \`<cwd>/game-design/\` 同目录已有文档保持一致.

## 1. 角色三视图

**路径**: \`<cwd>/game-design/characters/<name>.md\`

### 必含字段
- **身份背景**: 姓名 / 种族 / 年龄 / 出身
- **核心动机**: 角色在游戏内追求什么 (一句话)
- **玩法定位**: 坦克 / 输出 / 辅助 / 控制 / 混合, 主属性倾向
- **关键技能 3-5 个**: 名称 + 冷却 + 数值锚点 (伤害/范围/效果)
- **数值锚点**: HP / MP / 攻速 / 移速 / 暴击率 (给数值表做参考)
- **玩法循环定位**: 这个角色在 30s 团队循环里承担什么

### ASCII 三视图 (可选)
\`\`\`
       [正面]
        /|\\ 
       / | \\
      /  |  \\
  ___/   |   \\___
 |    O  O    |
 |      <     |
 |    \\___/   |
 |   / | | \\  |
 |  /  | |  \\ |
  \\/  / \\  \\/
      /   \\
     /_____\\
       [侧面]
\`\`\`

## 2. 世界观框架

**路径**: \`<cwd>/game-design/world/<name>.md\`

### 必含四件套
- **时代背景**: 哪一年/纪元, 科技/魔法水平
- **地理**: 大陆/城市/区域, 玩家能去的地方清单
- **社会结构**: 政权/宗教/经济/阶级, 主要派系 3-5 个
- **核心冲突**: 玩家扮演的角色在世界中要解决的根本矛盾

### 与角色 / 关卡的交叉引用
- 哪些角色属于哪个派系
- 哪些关卡落在哪个区域
- 核心冲突如何驱动 30s 循环

## 3. 关卡机制

**路径**: \`<cwd>/game-design/levels/<level-name>.md\`

### 5 步拆解
1. **玩家目标**: 这关要达成什么 (一句话)
2. **阻碍**: 敌人/陷阱/地形/时间限制
3. **资源点**: 道具/回复点/技能点
4. **难度曲线**: 起始难度 → 中段峰值 → 终局缓降 (给一个数字范围)
5. **通关条件**: 必达成的目标, 可选支线

### ASCII 流程图 (推荐)
\`\`\`
[Start] → [Wave 1: 教学] → [Boss 1] → [Wave 2: 加压]
                                          ↓
                              [Boss 2 + 限时] → [End]
\`\`\`

## 跨系统一致性

每次写完一类,扫一眼其他两类是否还兼容:
- 新角色技能是否需要新关卡机制支撑?
- 新关卡是否引入了新世界观元素?
- 新世界观是否给旧角色加了新设定?

冲突先在文档里标注, 不要立刻改代码.
`,
};

const SKILL_NUMERICAL: DesignBuiltinSkill = {
  id: "design-numerical",
  name: "design-numerical",
  description:
    "游戏数值设计：属性 / 武器 / 掉落 / 经济四类表 + 数值平衡方法. 触发：用户要设计角色属性、武器数值、掉落表、经济系统、平衡手感.",
  body: `# 游戏数值设计

四类最常用的数值表 + 平衡方法. 优先 markdown 表格写到 \`<cwd>/game-design/tables/\`.

## 1. 角色属性表

**路径**: \`<cwd>/game-design/tables/character-stats.md\`

### 必含字段
| 字段 | 单位 | 范围 | 参考来源 | 备注 |
|------|------|------|----------|------|
| max_hp | 点 | 100-2000 | 类比 X 游戏 | 坦克 1.5x, 输出 0.8x |
| max_mp | 点 | 50-500 | 法师 200, 战士 50 | |
| attack_power | 点/秒 | 10-200 | | DPS = 攻速 × 伤害 |
| move_speed | 米/秒 | 3-8 | | |
| attack_speed | 次/秒 | 0.5-3.0 | | 攻速档位 0.2 步进 |
| crit_rate | 0-1 | 0.05-0.50 | | 默认 0.15 |
| crit_damage | 倍率 | 1.5-3.0 | | 默认 2.0 |

## 2. 武器数值表

**路径**: \`<cwd>/game-design/tables/weapons.md\`

### 字段
- 武器 ID / 名称 / 类型 (近战/远程/法器)
- 基础伤害 + 攻速 + 暴击率
- 稀有度 (普通/优秀/稀有/史诗/传说), 各稀有度数值放大系数
- 特殊效果 1-2 个 (击退/减速/燃烧/治疗), 触发条件 + 数值
- 等级缩放: 每升 1 级伤害放大 (e.g. ×1.05)

## 3. 掉落表

**路径**: \`<cwd>/game-design/tables/loot.md\`

### 三层结构
1. **掉落池** (loot pool): 每个怪物/宝箱对应一个池子
2. **权重**: 每个物品的掉落概率 (0-1, 总和可不等于 1, 内部归一)
3. **保底**: 连续 N 次未出稀有品的补偿 (e.g. 10 次必出史诗)

### 字段
- 池 ID / 来源怪物 / 物品清单 / 权重 / 保底计数

## 4. 经济表

**路径**: \`<cwd>/game-design/tables/economy.md\`

### 货币种类
- 金币 (硬通货, 不可销毁)
- 宝石 (充值, 高价值)
- 代币 (活动限定, 周期重置)

### 收入 / 支出
- 每局平均收入 (按关卡难度阶梯)
- 商店价格 (e.g. 强化 1 级 = 100 金币, 2 级 = 280, 3 级 = 580 — 指数增长)
- 失败成本 (复活 / 跳过 / 加速)

## 数值平衡方法

### 倍率系数
所有数值与 1 个基准角色对齐, 其他角色用倍率缩放 (e.g. 坦克 HP ×1.5, 攻速 ×0.7).

### 边际收益递减
每升 1 级的成本指数增长 (Lv2 = Lv1 × 2, Lv3 = Lv2 × 2.5, 不是 ×2 直线), 防止后期刷子无脑堆.

### 内部循环自洽
- 30s 循环期望产出: X 金币 / Y 经验
- 升级到下一级所需: 8 × 上一级时间 (玩家 8 小时 1 级时升级感最佳)
- 商店物品 30 分钟可买, 不要让玩家卡在攒 8 小时

### 平衡检验
写完表后用 1 个公式自检:
\`\`\`
DPS = attack_power × attack_speed × (1 + crit_rate × (crit_damage - 1))
期望 DPS = DPS × hit_rate  // 命中率
Ttk = enemy_hp / expected_dps  // Time To Kill
\`\`\`
Ttk 应在 5-30 秒区间内, 太短无反馈, 太长无爽感.

## Godot / Excel 落地

- **快速验证**: markdown 表格足够, 数值小步迭代直接在 md 里改
- **需运行时读取**: 改为 \`.tres\` (Godot Resource) 或 \`.json\` (引擎无关), 由代码加载
- **多人协作**: Excel/Google Sheets 维护, 导出 .csv 后用 \`godot-import\` 转 .tres

数值表跨会话复用 → **保存到项目**, 不要只留在对话里.
`,
};

const SKILL_CORE_LOOP: DesignBuiltinSkill = {
  id: "design-core-loop",
  name: "design-core-loop",
  description:
    "核心玩法循环定义：30s 短期循环 + 长期目标 + 乐趣来源四象限 + 循环验证 checklist. 触发：用户要梳理核心玩法、问'我做的游戏好玩在哪'.",
  body: `# 核心玩法循环

核心循环是游戏设计的灵魂. 任何游戏都能用 3 个时间尺度拆解.

## 1. 30s 短期循环 (Micro Loop)

玩家 30 秒内反复做的事. 例:
- **消除游戏**: 拖方块 → 3 连消除 → 资源 +10 → 升级技能 → 消除更多方块
- **ARPG**: 砍怪 → 掉落 → 拾取 → 装备升级 → 砍更强的怪
- **策略**: 布阵 → 战斗 → 胜利/失败 → 调整阵型

**输出格式**:
\`\`\`
玩家行为 1 → 反馈 1 (立即)
玩家行为 2 → 反馈 2 (立即)
... 3-5 步 ...
回到行为 1 (闭环)
\`\`\`

每步必须有 **立即反馈** (数字飘字/震动/音效/视觉特效),否则循环断裂.

## 2. 中期循环 (Meta Loop, 5-30 分钟)

跨多局/多关卡的进度:
- 一局 5 分钟 → 通关奖励 → 解锁新关卡
- 一场战斗 2 分钟 → 胜负记录 → 排位分升降
- 一次探索 10 分钟 → 发现新区域 → 解锁新剧情

**驱动**: 资源积累 / 角色成长 / 解锁内容

## 3. 长期目标 (Macro Loop, 数小时-数天)

玩家在游戏里持续玩 10+ 小时的动力:
- 剧情主线 (RPG)
- 排位天梯 (竞技)
- 全收集 / 全成就
- PvP 段位
- 多人公会建设

**关键**: 长期目标**必须**通过中期循环 + 短期循环落地, 不能悬空.
如果长期目标是"通关",每一关都必须有可玩的 30s 循环.

## 4. 乐趣来源四象限

每个游戏至少 1-2 个主导象限:

| 象限 | 代表 | 例 |
|------|------|-----|
| **策略** | 决策深度 | 国际象棋 / 文明 / 杀戮尖塔 |
| **操作** | 手眼协调爽感 | 平台跳跃 / 音游 / 鬼泣 |
| **探索** | 发现惊喜 | Metroidvania / 开放世界 |
| **叙事** | 故事沉浸 | 视觉小说 / 日式 RPG |

**避免单象限**:
- 只有操作 → 容易腻
- 只有叙事 → 战斗枯燥
- 只有策略 → 心流门槛高
- 只有探索 → 后期无目标

**寻找交叉**:
- 策略 + 操作 = 竞技 (LoL/街霸)
- 策略 + 叙事 = CRPG (博德之门)
- 操作 + 探索 = Metroidvania
- 探索 + 叙事 = 塞尔达

## 5. 循环验证 Checklist

写完核心循环后, 自检 7 条:

- [ ] 30s 循环有 3-5 步, 每步有立即反馈
- [ ] 中期循环闭环, 5-30 分钟一个完整周期
- [ ] 长期目标通过中/短循环落地, 不悬空
- [ ] 至少 1-2 个乐趣象限占主导
- [ ] 单象限不超过 70% 比重
- [ ] 30s 循环在 5-10 局后仍有趣 (避免 30s 内就腻)
- [ ] 玩家 1 分钟内能理解核心循环 (新玩家测试)

## 6. 反模式

❌ **循环不闭环**: 砍怪不掉落, 升级无反馈 → 玩家 5 分钟内流失
❌ **循环太短**: 30s 循环 < 3 步 → 没策略深度
❌ **循环太长**: 30s 循环 > 10 步 → 玩家记不住
❌ **多循环打架**: 3 个不同节奏的循环争夺玩家注意力
❌ **循环有最优解**: 玩家找出最优解后无事可做

## 输出文档

**路径**: \`<cwd>/game-design/core-loop.md\`

必含: 30s 循环图 + 中期循环 + 长期目标 + 乐趣象限 + checklist 自检结果.

写完先自评, 不通过就别继续写其他系统.
`,
};

/** 全部 5 条 BUILTIN 的导出 (按 frontmatter 顺序). */
export const DESIGN_BUILTIN_SKILLS: readonly DesignBuiltinSkill[] = [
  SKILL_INITIATION,
  SKILL_PROCESS,
  SKILL_SYSTEMS,
  SKILL_NUMERICAL,
  SKILL_CORE_LOOP,
] as const;

/** 5 条 id, 与 `prioritizeDesignSkills` 排序对齐. */
export const BUILTIN_DESIGN_SKILL_IDS: readonly string[] =
  DESIGN_BUILTIN_SKILLS.map((s) => s.id);

// ===== 懒写辅助 =====

/** 拼 frontmatter + body 成完整 SKILL.md 文本. */
export function formatSkillMdContent(skill: DesignBuiltinSkill): string {
  return (
    `---\n` +
    `name: ${skill.name}\n` +
    `description: ${JSON.stringify(skill.description)}\n` +
    `---\n\n` +
    `${skill.body.trimEnd()}\n`
  );
}

/** 算 SHA-256 hex. */
function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** 默认 user skill 安装目录: ${agentDirPath}/skills/. */
export function getBuiltinSkillsInstallDir(agentDirPath: string = defaultAgentDirPath()): string {
  return path.join(agentDirPath, "skills");
}

/** 给定 id 返回完整 SKILL.md 路径. */
export function getBuiltinSkillFilePath(id: string, agentDirPath?: string): string {
  return path.join(getBuiltinSkillsInstallDir(agentDirPath), id, "SKILL.md");
}

/** install 记录文件: ~/.pi/agent/x-agent/builtin-skills-installed.json. */
export function getInstallRecordPath(agentDirPath: string): string {
  return path.join(agentDirPath, "x-agent", "builtin-skills-installed.json");
}

type InstallRecord = {
  /** 安装时间, ISO 字符串. */
  installedAt: string;
  /** 记录每个 BUILTIN id 的 SHA-256 (内容稳定后才记). */
  sha256: Record<string, string>;
};

function readInstallRecord(agentDirPath: string): InstallRecord {
  const p = getInstallRecordPath(agentDirPath);
  if (!existsSync(p)) return { installedAt: new Date(0).toISOString(), sha256: {} };
  try {
    const raw = readFileSync(p, "utf8");
    const parsed = JSON.parse(raw) as Partial<InstallRecord>;
    return {
      installedAt: typeof parsed.installedAt === "string" ? parsed.installedAt : new Date(0).toISOString(),
      sha256: (parsed.sha256 ?? {}) as Record<string, string>,
    };
  } catch {
    return { installedAt: new Date(0).toISOString(), sha256: {} };
  }
}

function writeInstallRecord(agentDirPath: string, record: InstallRecord): void {
  const p = getInstallRecordPath(agentDirPath);
  mkdirSync(path.join(agentDirPath, "x-agent"), { recursive: true });
  // 简单原子写:写 .tmp 后 rename
  const tmp = `${p}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(record, null, 2), "utf8");
  // rename 在同 volume 上是原子的 (NTFS MoveFileExW + POSIX rename)
  renameSync(tmp, p);
}

export type EnsureBuiltinSkillsOptions = {
  /** 强制覆盖所有 5 个 BUILTIN (无视 sha256 记录). */
  force?: boolean;
  /** 测试可注入: agentDir 路径. 默认 process.env.X_AGENT_AGENT_DIR ?? ~/.pi/agent */
  agentDirPath?: string;
};

export type EnsureBuiltinSkillsResult = {
  /** 实际写入的文件数 (新建 + 覆盖). */
  written: number;
  /** 跳过的文件数 (磁盘 sha256 与记录一致, 跳过). */
  skipped: number;
  /** 失败的 id 列表 (权限等). 不抛错, 静默吞. */
  failed: string[];
};

/**
 * 把 5 条 BUILTIN SKILL.md 懒写到 ~/.pi/agent/skills/design-<id>/SKILL.md.
 *
 * 幂等策略 (用户修改保护):
 * 1. 文件不存在 → 写入
 * 2. 文件存在 + sha256 与上次记录一致 → 跳过
 * 3. 文件存在 + sha256 与记录不一致 → 用户改过, **跳过不覆盖** (用户内容优先)
 * 4. force: true → 无视所有跳过, 强制覆盖所有
 *
 * 不抛错: 写盘失败返回 failed 列表, caller 决定怎么处理.
 */
export function ensureBuiltinDesignSkillsInstalled(
  options: EnsureBuiltinSkillsOptions = {},
): EnsureBuiltinSkillsResult {
  const agentDirPath = options.agentDirPath ?? defaultAgentDirPath();

  const skillsDir = getBuiltinSkillsInstallDir(agentDirPath);
  const record = options.force
    ? { installedAt: new Date(0).toISOString(), sha256: {} as Record<string, string> }
    : readInstallRecord(agentDirPath);

  const result: EnsureBuiltinSkillsResult = { written: 0, skipped: 0, failed: [] };
  const newSha: Record<string, string> = { ...record.sha256 };
  const force = options.force === true;

  // 一次性建好 skills 目录
  try {
    mkdirSync(skillsDir, { recursive: true });
  } catch (err) {
    // 整个 install 没法做, 直接返回
    return {
      written: 0,
      skipped: 0,
      failed: DESIGN_BUILTIN_SKILLS.map((s) => s.id),
    };
  }

  for (const skill of DESIGN_BUILTIN_SKILLS) {
    const targetDir = path.join(skillsDir, skill.id);
    const targetPath = path.join(targetDir, "SKILL.md");
    const content = formatSkillMdContent(skill);
    const sha = sha256Hex(content);

    try {
      if (existsSync(targetPath) && !force) {
        const onDisk = readFileSync(targetPath, "utf8");
        // 内容完全一致 (含我自己的 sha) → 跳过, 维持记录
        if (onDisk === content) {
          newSha[skill.id] = sha;
          result.skipped += 1;
          continue;
        }
        // 内容不一致 → 用户改过 (或上次写盘后外部改动), 默认保留, 不覆盖
        // (下次 install 还会重新比对, 仍能识别为\"用户改过\")
        result.skipped += 1;
        continue;
      }
      // 写盘 (新建 / 不存在 / force 覆盖)
      mkdirSync(targetDir, { recursive: true });
      const tmp = `${targetPath}.${randomUUID()}.tmp`;
      writeFileSync(tmp, content, "utf8");
      renameSync(tmp, targetPath);
      newSha[skill.id] = sha;
      result.written += 1;
    } catch {
      result.failed.push(skill.id);
    }
  }

  // 写记录: 只在至少有一次成功写入或之前有记录时
  if (Object.keys(newSha).length > 0 || record.sha256) {
    try {
      writeInstallRecord(agentDirPath, {
        installedAt: new Date().toISOString(),
        sha256: newSha,
      });
    } catch {
      // 记录写失败不影响 install 结果
    }
  }

  return result;
}
