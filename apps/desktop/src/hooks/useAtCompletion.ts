/**
 * @-补全 hook —— 复用 useSlashMenu 的设计，但触发键是 @。
 *
 * 设计要点：
 * - 不接管 textarea 的 onKeyDown / onChange（与 useSlashMenu 一致，由 ChatPanel 协调）
 * - 类别三选一：path / skill / mode（data 来自 props）
 * - path 候选需要项目 cwd 上下文；本 hook 仅暴露状态机，候选由 ChatPanel 注入
 * - 完整 UI 文案依赖 i18n（ROADMAP 1.4），当前先用中文硬编码，后续替换
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  applyAtItemInsert,
  detectAtFragment,
  filterModeCandidates,
  filterPathCandidates,
  filterSkillCandidates,
  type AtCategory,
  type AtMatch,
} from "@/lib/at-completion";

export type AtPathCandidate = string;

export interface AtSkillCandidate {
  name: string;
  description?: string;
}

export interface AtModeCandidate {
  id: string;
  label: string;
  hint: string;
}

export type AtCandidate =
  | { kind: "path"; id: string }
  | { kind: "skill"; id: string; description?: string }
  | { kind: "mode"; id: string; label: string; hint: string };

export interface UseAtCompletionOpts {
  input: string;
  cursor: number;
  disabled: boolean;
  /** 项目 cwd 下文件相对路径列表（已 resolve 安全） */
  pathCandidates?: AtPathCandidate[];
  /** 已注册技能 */
  skillCandidates?: AtSkillCandidate[];
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  setInput: (v: string) => void;
}

export interface UseAtCompletionResult {
  match: AtMatch | null;
  menuOpen: boolean;
  candidates: AtCandidate[];
  highlight: number;
  setHighlight: React.Dispatch<React.SetStateAction<number>>;
  selectCandidate: (candidate: AtCandidate) => void;
  dismissMenu: () => void;
}

export function useAtCompletion(opts: UseAtCompletionOpts): UseAtCompletionResult {
  const {
    input,
    cursor,
    disabled,
    pathCandidates = [],
    skillCandidates = [],
    textareaRef,
    setInput,
  } = opts;
  const [highlight, setHighlight] = useState(0);
  const [menuDismissed, setMenuDismissed] = useState(false);

  const match = useMemo<AtMatch | null>(() => {
    if (disabled) return null;
    return detectAtFragment(input, cursor);
  }, [disabled, input, cursor]);

  const menuOpen = Boolean(match) && !menuDismissed;

  const candidates = useMemo<AtCandidate[]>(() => {
    if (!match) return [];
    switch (match.category) {
      case "path":
        return filterPathCandidates(pathCandidates, match.query).map((p) => ({
          kind: "path",
          id: p,
        }));
      case "skill":
        return filterSkillCandidates(skillCandidates, match.query).map((s) => ({
          kind: "skill",
          id: s.name,
          description: s.description,
        }));
      case "mode":
        return filterModeCandidates(match.query).map((m) => ({
          kind: "mode",
          id: m.id,
          label: m.label,
          hint: m.hint,
        }));
    }
  }, [match, pathCandidates, skillCandidates]);

  // 用户重新输入或换模式 → 重置高亮与 dismiss 状态
  useEffect(() => {
    setHighlight(0);
    setMenuDismissed(false);
  }, [match?.start, match?.end, match?.query]);

  const selectCandidate = useCallback(
    (candidate: AtCandidate) => {
      if (!match) return;
      const result = applyAtItemInsert(input, match, {
        kind: candidate.kind,
        id: candidate.id,
      });
      setInput(result.value);
      const el = textareaRef.current;
      if (el) {
        // 同步光标 + 让菜单状态自然关闭
        requestAnimationFrame(() => {
          el.focus();
          el.setSelectionRange(result.cursor, result.cursor);
        });
      }
      setMenuDismissed(true);
    },
    [input, match, setInput, textareaRef],
  );

  const dismissMenu = useCallback(() => setMenuDismissed(true), []);

  return {
    match,
    menuOpen,
    candidates,
    highlight,
    setHighlight,
    selectCandidate,
    dismissMenu,
  };
}
