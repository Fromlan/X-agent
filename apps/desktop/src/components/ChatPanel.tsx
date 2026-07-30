import type { AgentStatus, SessionSkillInfo } from "@shared/ipc";
import type { ChatItem } from "../stores/chat-store";
import { ChatTranscript } from "./ChatTranscript";
import { SkillSlashMenu } from "./SkillSlashMenu";
import {
  applySkillSlashInsert,
  detectSkillSlash,
  filterSkillsByQuery,
  type SkillSlashMatch,
} from "../lib/skill-slash";
import { Send, Square } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";

interface Props {
  items: ChatItem[];
  showThinking: boolean;
  status: AgentStatus;
  input: string;
  setInput: (v: string) => void;
  onSend: () => void;
  onAbort: () => void;
  disabled: boolean;
  /** Bump after reloadResources so skills cache refreshes. */
  skillsRefreshKey?: string | number;
  queuedSteering?: string[];
  forceFollowKey?: string;
  onOpenToolInPanel?: (toolId: string, args: unknown) => void;
  editingEntryId?: string | null;
  editDraft?: string;
  onEditDraftChange?: (text: string) => void;
  onStartEdit?: (entryId: string, text: string) => void;
  onCancelEdit?: () => void;
  onConfirmEdit?: () => void;
  onRetract?: (entryId: string) => void;
  onRegenerate?: (userEntryId: string) => void;
  starters?: { id: string; label: string; prompt: string }[];
  readinessHints?: { label: string; onClick: () => void }[];
  onPickStarter?: (prompt: string) => void;
}

export function ChatPanel(props: Props) {
  const streaming =
    props.status === "streaming" || props.status === "retrying";
  const composerLocked = props.disabled || Boolean(props.editingEntryId);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [cursor, setCursor] = useState(0);
  const [skills, setSkills] = useState<SessionSkillInfo[]>([]);
  const [skillsLoaded, setSkillsLoaded] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [menuDismissed, setMenuDismissed] = useState(false);

  const slashMatch: SkillSlashMatch | null = useMemo(() => {
    if (composerLocked) return null;
    return detectSkillSlash(props.input, cursor);
  }, [composerLocked, props.input, cursor]);

  const menuOpen = Boolean(slashMatch) && !menuDismissed;

  const filtered = useMemo(
    () => filterSkillsByQuery(skills, slashMatch?.query ?? ""),
    [skills, slashMatch?.query],
  );

  useEffect(() => {
    setSkillsLoaded(false);
    setSkills([]);
  }, [props.skillsRefreshKey, props.disabled]);

  useEffect(() => {
    if (!menuOpen || skillsLoaded || props.disabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const list = await window.xAgent.listSessionSkills();
        if (!cancelled) {
          setSkills(list);
          setSkillsLoaded(true);
        }
      } catch {
        if (!cancelled) {
          setSkills([]);
          setSkillsLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [menuOpen, skillsLoaded, props.disabled]);

  useEffect(() => {
    setHighlight(0);
  }, [slashMatch?.query, slashMatch?.start]);

  useEffect(() => {
    if (!slashMatch) setMenuDismissed(false);
  }, [slashMatch]);

  const selectSkill = useCallback(
    (skill: SessionSkillInfo) => {
      const match = detectSkillSlash(
        props.input,
        textareaRef.current?.selectionStart ?? cursor,
      );
      if (!match) return;
      const { value, cursor: nextCursor } = applySkillSlashInsert(
        props.input,
        match,
        skill.name,
      );
      props.setInput(value);
      setMenuDismissed(true);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(nextCursor, nextCursor);
        setCursor(nextCursor);
      });
    },
    [cursor, props],
  );

  const onChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    props.setInput(e.target.value);
    setCursor(e.target.selectionStart);
    setMenuDismissed(false);
  };

  const syncCursor = () => {
    const el = textareaRef.current;
    if (el) setCursor(el.selectionStart);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (menuOpen) {
      if (e.key === "Escape") {
        e.preventDefault();
        setMenuDismissed(true);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (filtered.length === 0) return;
        setHighlight((i) => (i + 1) % filtered.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (filtered.length === 0) return;
        setHighlight((i) => (i - 1 + filtered.length) % filtered.length);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const skill = filtered[highlight] ?? filtered[0];
        if (skill) selectSkill(skill);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (props.input.trim()) props.onSend();
    }
  };

  return (
    <section className="chat-panel">
      <ChatTranscript
        items={props.items}
        showThinking={props.showThinking}
        status={props.status}
        disabledEmpty={props.disabled}
        starters={props.starters}
        readinessHints={props.readinessHints}
        onPickStarter={props.onPickStarter}
        forceFollowKey={props.forceFollowKey}
        degradeMarkdown={props.items.length > 40}
        onOpenToolInPanel={props.onOpenToolInPanel}
        editingEntryId={props.editingEntryId}
        editDraft={props.editDraft}
        onEditDraftChange={props.onEditDraftChange}
        onStartEdit={props.onStartEdit}
        onCancelEdit={props.onCancelEdit}
        onConfirmEdit={props.onConfirmEdit}
        onRetract={props.onRetract}
        onRegenerate={props.onRegenerate}
      />

      {props.queuedSteering && props.queuedSteering.length > 0 && (
        <div className="queue-banner">
          已排队 steer：{props.queuedSteering.map((t) => `"${t.slice(0, 40)}"`).join(" · ")}
        </div>
      )}

      <div className="composer">
        <div className="composer-shell">
          <SkillSlashMenu
            open={menuOpen}
            skills={filtered}
            query={slashMatch?.query ?? ""}
            highlightIndex={Math.min(
              highlight,
              Math.max(0, filtered.length - 1),
            )}
            onHighlightChange={setHighlight}
            onSelect={selectSkill}
            onClose={() => setMenuDismissed(true)}
          />
          <textarea
            ref={textareaRef}
            value={props.input}
            onChange={onChange}
            onKeyDown={onKeyDown}
            onClick={syncCursor}
            onKeyUp={syncCursor}
            onSelect={syncCursor}
            placeholder={
              props.disabled
                ? "请先打开项目…"
                : props.editingEntryId
                  ? "正在编辑历史消息 — 请先确认或取消编辑"
                  : streaming
                    ? "运行中：Enter 发送 steer，Shift+Enter 换行，/ 选择技能"
                    : "输入消息，Enter 发送，Shift+Enter 换行，/ 选择技能"
            }
            disabled={composerLocked}
            rows={2}
            aria-disabled={composerLocked}
            aria-autocomplete="list"
            aria-expanded={menuOpen}
          />
          <div className="composer-toolbar">
            <span className="composer-hint" aria-hidden="true">
              {streaming
                ? "Steer · / 技能 · Shift+Enter 换行"
                : "Enter 发送 · / 选择技能 · Shift+Enter 换行"}
            </span>
            <div className="composer-actions">
              {streaming && (
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={props.onAbort}
                >
                  <Square size={14} />
                  中止
                </button>
              )}
              <button
                type="button"
                className="btn btn-cta btn-sm composer-send"
                onClick={props.onSend}
                disabled={
                  props.disabled ||
                  !props.input.trim() ||
                  Boolean(props.editingEntryId)
                }
              >
                <Send size={14} />
                {streaming ? "Steer" : "发送"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
