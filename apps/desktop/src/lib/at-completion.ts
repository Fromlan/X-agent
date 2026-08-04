/**
 * @-补全核心数据派生。
 * 复用 src/lib/slash-menu.ts 的设计 —— 检测 / 过滤 / 插入三段。
 *
 * 触发场景（与 AGENT.md §8 / CONTEXT.md 提到的 `@路径` 对齐）：
 *   - `@path/...`        → 项目文件相对路径
 *   - `@skill:name...`   → 技能补全（落点与 `/skill:name` 同义）
 *   - `@mode:plan`       → 会话模式提示（落点写 `/mode plan` 形式）
 *
 * 不接管 onKeyDown / onChange —— 留在 ChatPanel / Composer。
 */

export type AtCategory = "path" | "skill" | "mode";

export type AtMatch = {
  /** 类别（@ 之后第一个 token 决定） */
  category: AtCategory;
  /** 完整 @ 片段在 input 中的 [start, end) 区间 */
  start: number;
  end: number;
  /** 类别前缀（如 "skill" / "mode"），用于二级过滤 */
  prefix: string;
  /** 用户输入的二级 query（去掉前缀后） */
  query: string;
};

const PATH_TAIL = /[A-Za-z0-9_./\\-]*/;

/**
 * 探测光标前是否处于 @ 补全状态。
 * 仅识别 `^@\w*` 或 `[\s]@\w*` 的形式；`name@host` 这种邮箱不会触发。
 */
export function detectAtFragment(value: string, cursor: number): AtMatch | null {
  const safeCursor = Math.max(0, Math.min(cursor, value.length));
  const before = value.slice(0, safeCursor);
  // 匹配最后一个 @ 及后续非空白字符
  const m = before.match(/(?:^|[\s])@([^\s]*)$/);
  if (!m) return null;
  const tail = m[1] ?? "";
  const atIndex = before.length - tail.length - 1;
  if (value[atIndex] !== "@") return null;
  if (!m[0].startsWith("@") && !m[0].endsWith("@")) {
    // 严格确认是 @ 而不是被前一个 token 吃掉
    if (!/[^\w]@$/.test(before.slice(0, atIndex + 1))) return null;
  }
  // 分类：@skill:xxx / @mode:xxx / @xxx（默认 path）
  if (tail.startsWith("skill:")) {
    return {
      category: "skill",
      start: atIndex,
      end: safeCursor,
      prefix: "skill",
      query: tail.slice("skill:".length),
    };
  }
  if (tail.startsWith("mode:")) {
    return {
      category: "mode",
      start: atIndex,
      end: safeCursor,
      prefix: "mode",
      query: tail.slice("mode:".length),
    };
  }
  return {
    category: "path",
    start: atIndex,
    end: safeCursor,
    prefix: "",
    query: tail,
  };
}

/** 过滤 path 候选（项目内文件） */
export function filterPathCandidates(
  candidates: string[],
  query: string,
): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return candidates.slice(0, 30);
  return candidates
    .filter((c) => c.toLowerCase().includes(q))
    .slice(0, 30);
}

/** 过滤 skill 候选（来自已有 skill 列表） */
export function filterSkillCandidates(
  items: Array<{ name: string; description?: string }>,
  query: string,
): Array<{ name: string; description?: string }> {
  const q = query.trim().toLowerCase();
  if (!q) return items.slice(0, 30);
  return items
    .filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        (i.description ?? "").toLowerCase().includes(q),
    )
    .slice(0, 30);
}

/** 过滤 mode 候选 */
export function filterModeCandidates(
  query: string,
): Array<{ id: string; label: string; hint: string }> {
  const all = [
    { id: "agent", label: "Agent", hint: "常规编码模式（默认）" },
    { id: "ask", label: "调研", hint: "只读问答，不写文件" },
    { id: "plan", label: "Plan", hint: "只读研究 + 写计划" },
    { id: "goal", label: "目标", hint: "带完成条件的自治模式" },
  ];
  const q = query.trim().toLowerCase();
  if (!q) return all;
  return all.filter(
    (m) =>
      m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q),
  );
}

/**
 * 将候选插入文本。返回 {value, cursor} 用于更新 textarea。
 * - path: `@src/foo.gd` → 在 input 中替换为完整路径
 * - skill: 转写为 `/skill:name`（slash 系统已有的处理路径）
 * - mode: 转写为 `/mode plan`（plan / goal 等可在 model 侧被识别）
 */
export function applyAtItemInsert(
  value: string,
  match: AtMatch,
  payload: { kind: AtCategory; id: string },
): { value: string; cursor: number } {
  let token: string;
  switch (payload.kind) {
    case "path":
      token = `@${payload.id.replace(/\\/g, "/")}`;
      break;
    case "skill":
      token = `/skill:${payload.id} `;
      break;
    case "mode":
      token = `/mode ${payload.id} `;
      break;
  }
  const next = value.slice(0, match.start) + token + value.slice(match.end);
  return { value: next, cursor: match.start + token.length };
}

/** 类别标签（用于菜单标题；i18n 后续接入） */
export function atCategoryLabel(category: AtCategory): string {
  switch (category) {
    case "path":
      return "文件";
    case "skill":
      return "技能";
    case "mode":
      return "模式";
  }
}

/** 检测一个输入片段是否「看起来像」path 候选（用于渐进展示） */
export function looksLikePathCandidate(fragment: string): boolean {
  // 不含空白、不含冒号（非 URL）、允许字母数字与 ./-\_
  return PATH_TAIL.test(fragment) && !/:\/\//.test(fragment);
}
