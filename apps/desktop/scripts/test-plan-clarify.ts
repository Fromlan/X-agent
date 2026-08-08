import assert from "node:assert/strict";
import {
  formatClarifyReply,
  parseClarifyBlocks,
} from "../src/lib/plan-clarify.ts";

const text = [
  "Need a few choices:",
  "<clarify>",
  "Q: Which renderer?",
  "- Forward+",
  "- Mobile",
  "- Either",
  "</clarify>",
  "",
  "<clarify>",
  "Q: Scope?",
  "1. MVP",
  "2. Full",
  "</clarify>",
].join("\n");

const qs = parseClarifyBlocks(text);
assert.equal(qs.length, 2);
assert.equal(qs[0].question, "Which renderer?");
assert.deepEqual(qs[0].options, ["Forward+", "Mobile", "Either"]);
assert.equal(qs[1].options.length, 2);

assert.equal(parseClarifyBlocks("no blocks").length, 0);
assert.equal(
  parseClarifyBlocks("<clarify>\nQ: Only one?\n- A\n</clarify>").length,
  0,
  "need >=2 options",
);

const reply = formatClarifyReply([
  { question: "Which renderer?", option: "Mobile" },
]);
assert.ok(reply.includes("Which renderer?"));
assert.ok(reply.includes("→ Mobile"));


// --- Inline (single-line) format tests ---

// 截图实际格式:模型有时把所有内容塞进一行,用 " - " 分隔选项
{
  const inlineText = [
    "Some preceding markdown...",
    "<clarify> Q1: 次次到底要转哪些动画序列？（决定文件数量和工作量） - 选项 A: 仅最常用的几组 (塔待机 Idle、弓手 Idle/Attack/Preattack、敌人 Walk/Attack/Death), 约 35~50 个 SpriteFrames - 选项 B: 把 A、B 类里所有纵向帧序列都做掉 (约 80~100+ 个 SpriteFrames) - 选项 C: 只挑一个做端到端示例 (如塔 Idle), 其余沿用同样模板手动扩 </clarify>",
    "<clarify> Q2: 交付形式是？ - 选项 A: 只生成 SpriteFrames 资源文件 (.tres) - 选项 B: 每个动画对应一个 .tscn 场景 - 选项 C: A+B 都做 </clarify>"
  ].join("\n");
  const inlineQs = parseClarifyBlocks(inlineText);
  assert.equal(inlineQs.length, 2, "both inline blocks should parse");
  assert.equal(inlineQs[0].question, "次次到底要转哪些动画序列？（决定文件数量和工作量）");
  assert.equal(inlineQs[0].options.length, 3, "3 options from 选项 A/B/C");
  assert.deepEqual(inlineQs[0].options, [
    "仅最常用的几组 (塔待机 Idle、弓手 Idle/Attack/Preattack、敌人 Walk/Attack/Death), 约 35~50 个 SpriteFrames",
    "把 A、B 类里所有纵向帧序列都做掉 (约 80~100+ 个 SpriteFrames)",
    "只挑一个做端到端示例 (如塔 Idle), 其余沿用同样模板手动扩"
  ], "option text should drop 选项 X: prefix");
  assert.equal(inlineQs[1].question, "交付形式是？");
  assert.deepEqual(inlineQs[1].options, [
    "只生成 SpriteFrames 资源文件 (.tres)",
    "每个动画对应一个 .tscn 场景",
    "A+B 都做"
  ]);
}

// 简化的内联格式:没有"选项"前缀,直接 "A:" / "B:"
{
  const r = parseClarifyBlocks("<clarify> Q: which way? - A: forward - B: backward </clarify>");
  assert.equal(r.length, 1);
  assert.equal(r[0].question, "which way?");
  assert.deepEqual(r[0].options, ["forward", "backward"]);
}

// 全角冒号 ： 也接受
{
  const r = parseClarifyBlocks("<clarify> Q：问题？ - 选项 A：opt1 - 选项 B：opt2 </clarify>");
  assert.equal(r.length, 1);
  assert.equal(r[0].question, "问题？");
  assert.deepEqual(r[0].options, ["opt1", "opt2"]);
}

// 单行但只有 1 个选项 → 不入列
{
  const r = parseClarifyBlocks("<clarify> Q: only one? - A: yes </clarify>");
  assert.equal(r.length, 0, "need >=2 options for inline too");
}

// 单行但缺少 Q 前缀 → 不入列
{
  const r = parseClarifyBlocks("<clarify> hello - 选项 A: opt1 - 选项 B: opt2 </clarify>");
  assert.equal(r.length, 0, "inline must start with Q...: ");
}

// 多块混排:第一个多行,第二个内联 → 都入列
{
  const mixed = [
    "<clarify>",
    "Q: multi?",
    "- A",
    "- B",
    "</clarify>",
    "",
    "<clarify> Q2: inline? - 选项 A: opt1 - 选项 B: opt2 </clarify>"
  ].join("\n");
  const r = parseClarifyBlocks(mixed);
  assert.equal(r.length, 2, "multi-line + inline should both parse");
  assert.equal(r[0].question, "multi?");
  assert.deepEqual(r[0].options, ["A", "B"]);
  assert.equal(r[1].question, "inline?");
  assert.deepEqual(r[1].options, ["opt1", "opt2"]);
}

// 单行里选项文本含 ": " 但不是 "X:" 前缀(冒号在数字范围 / 描述中间)→ 不被剥前缀
{
  const r = parseClarifyBlocks("<clarify> Q: rate? - A: 6 FPS - B: 12 FPS - C: 18 FPS </clarify>");
  assert.deepEqual(r[0].options, ["6 FPS", "12 FPS", "18 FPS"]);
}

// 多行单块多问题:Q1/Q2/Q3 各自带选项,选项归属各自问题
{
  const multi = [
    "<clarify>",
    "Q1: 第一步的交付范围？",
    "- A: 第一关最小可玩闭环（推荐）：数据层 + 地图 + 史莱姆移动/分裂 + 箭塔射击 + 路障阻挡/维修 + 尖刺 + 开波/波次 + 补给经济 + 营火耐久 + 极简 HUD + 胜败/重试",
    "- B: 先做白盒框架：数据层 + 场景骨架 + 极简 HUD，敌人/塔先用占位色块验证战斗规则",
    "- C: 只搭数据层：枚举 + 数据类 + Level 1 JSON 数据 + 加载测试",
    "Q2: 中文 UI 字体怎么解决？（项目无字体文件）",
    "",
    "A: 添加可商用中文字体（如思源黑体/霞鹜文楷，约 5–15MB）",
    "B: 用 Godot SystemFont 引用 Windows 系统字体",
    "C: 第一步 UI 先用英文/拼音占位",
    "Q3: 第一步 UI 的呈现方式？（GDD §17.1 允许原型用程序绘制）",
    "",
    "A: 程序绘制九宫格面板 + 文字 + 简单图标（推荐）",
    "B: 第一步就要像素风美术 UI",
    "</clarify>",
  ].join("\n");
  const r = parseClarifyBlocks(multi);
  assert.equal(r.length, 3, "3 questions in one multi-line block");
  assert.equal(r[0].question, "第一步的交付范围？");
  assert.equal(r[0].options.length, 3, "Q1 keeps its own 3 options");
  assert.deepEqual(r[0].options, [
    "第一关最小可玩闭环（推荐）：数据层 + 地图 + 史莱姆移动/分裂 + 箭塔射击 + 路障阻挡/维修 + 尖刺 + 开波/波次 + 补给经济 + 营火耐久 + 极简 HUD + 胜败/重试",
    "先做白盒框架：数据层 + 场景骨架 + 极简 HUD，敌人/塔先用占位色块验证战斗规则",
    "只搭数据层：枚举 + 数据类 + Level 1 JSON 数据 + 加载测试",
  ]);
  assert.equal(r[1].question, "中文 UI 字体怎么解决？（项目无字体文件）");
  assert.deepEqual(r[1].options, [
    "添加可商用中文字体（如思源黑体/霞鹜文楷，约 5–15MB）",
    "用 Godot SystemFont 引用 Windows 系统字体",
    "第一步 UI 先用英文/拼音占位",
  ]);
  assert.equal(r[2].question, "第一步 UI 的呈现方式？（GDD §17.1 允许原型用程序绘制）");
  assert.deepEqual(r[2].options, [
    "程序绘制九宫格面板 + 文字 + 简单图标（推荐）",
    "第一步就要像素风美术 UI",
  ]);
}

// 多行块里 Q 行后选项不足 2 个 → 该问题不入列,其余问题保留
{
  const partial = [
    "<clarify>",
    "Q1: good?",
    "- A",
    "- B",
    "Q2: drop?",
    "- X",
    "</clarify>",
  ].join("\n");
  const r = parseClarifyBlocks(partial);
  assert.equal(r.length, 1, "question with <2 options is dropped");
  assert.equal(r[0].question, "good?");
  assert.deepEqual(r[0].options, ["A", "B"]);
}

console.log("test-plan-clarify: ok");
