import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Copy, Loader2, XCircle } from "lucide-react";
import {
  AVAILABLE_TOOLS,
  GODOT_DOCS_TOOLS,
  GODOT_TOOLS,
} from "@shared/ipc";
import type { ChatItem } from "../../stores/chat-store";
import {
  extractToolPath,
  setPreviewPath,
} from "../../stores/right-panel-store";

function formatMaybeJson(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

const BUILTIN_SET = new Set<string>(AVAILABLE_TOOLS);
const GODOT_EDITOR_SET = new Set<string>(GODOT_TOOLS);
const GODOT_DOCS_SET = new Set<string>(GODOT_DOCS_TOOLS);

type ToolGroupId = "builtin" | "godot-editor" | "godot-docs" | "other";

const TOOL_GROUPS: {
  id: ToolGroupId;
  label: string;
  chipClass: string;
}[] = [
  { id: "builtin", label: "内置", chipClass: "is-builtin" },
  { id: "godot-editor", label: "Godot 编辑器", chipClass: "is-godot" },
  { id: "godot-docs", label: "Godot 文档", chipClass: "is-docs" },
  { id: "other", label: "其他", chipClass: "is-other" },
];

function groupIdForTool(name: string): ToolGroupId {
  if (BUILTIN_SET.has(name)) return "builtin";
  if (GODOT_EDITOR_SET.has(name)) return "godot-editor";
  if (GODOT_DOCS_SET.has(name)) return "godot-docs";
  return "other";
}

interface Props {
  items: ChatItem[];
  enabledTools: string[];
  selectedToolId: string | null;
  onSelectTool: (toolId: string) => void;
}

export function ToolsTab({
  items,
  enabledTools,
  selectedToolId,
  onSelectTool,
}: Props) {
  const tools = useMemo(
    () =>
      items.filter(
        (i): i is Extract<ChatItem, { kind: "tool" }> => i.kind === "tool",
      ),
    [items],
  );

  const selected = tools.find((t) => t.id === selectedToolId) ?? null;
  const [detailArgs, setDetailArgs] = useState("");
  const [detailResult, setDetailResult] = useState("");
  const [detailTruncated, setDetailTruncated] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const groupedEnabled = useMemo(() => {
    const buckets: Record<ToolGroupId, string[]> = {
      builtin: [],
      "godot-editor": [],
      "godot-docs": [],
      other: [],
    };
    for (const name of enabledTools) {
      buckets[groupIdForTool(name)].push(name);
    }
    return TOOL_GROUPS.map((group) => ({
      ...group,
      tools: buckets[group.id],
    })).filter((group) => group.tools.length > 0);
  }, [enabledTools]);

  useEffect(() => {
    let cancelled = false;
    if (!selected) {
      setDetailArgs("");
      setDetailResult("");
      setDetailTruncated(false);
      setDetailError(null);
      return;
    }

    setDetailArgs(formatMaybeJson(selected.args));
    setDetailResult(formatMaybeJson(selected.result));
    setDetailTruncated(false);
    setDetailError(null);

    void window.xAgent.getToolDetail(selected.id).then((detail) => {
      if (cancelled || !detail) return;
      setDetailArgs(formatMaybeJson(detail.args));
      setDetailResult(formatMaybeJson(detail.result));
      setDetailTruncated(Boolean(detail.truncated));
      const path = extractToolPath(detail.args);
      if (path) setPreviewPath(path);
    });

    return () => {
      cancelled = true;
    };
  }, [selected]);

  const copyAll = async () => {
    const text = [
      selected ? `# ${selected.toolName}` : "",
      detailArgs ? `## args\n${detailArgs}` : "",
      detailResult ? `## result\n${detailResult}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setDetailError("复制失败");
    }
  };

  return (
    <div className="rp-tools">
      <div className="rp-section rp-tools-enabled">
        <div className="rp-section-label">
          已启用（{enabledTools.length}）
        </div>
        {enabledTools.length === 0 ? (
          <div className="rp-empty">设置 → 工具 中勾选后才会提供给 Agent。</div>
        ) : (
          <div className="rp-tool-groups">
            {groupedEnabled.map((group) => (
              <div key={group.id} className="rp-tool-group">
                <div className="rp-tool-group-label">
                  <span>{group.label}</span>
                  <span className="rp-tool-group-count">{group.tools.length}</span>
                </div>
                <div className="rp-tool-chips">
                  {group.tools.map((name) => (
                    <span
                      key={name}
                      className={`rp-tool-chip ${group.chipClass}`}
                      title={name}
                    >
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rp-section-label rp-tools-calls-label">本回合调用</div>
      {tools.length === 0 ? (
        <div className="rp-empty">
          还没有工具调用。Agent 运行后会出现在这里。
        </div>
      ) : (
        <div className="rp-tools-calls">
          <ul className="rp-tool-list">
            {tools.map((t) => {
              const active = t.id === selectedToolId;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    className={`rp-tool-item${active ? " active" : ""}${t.isError ? " is-error" : ""}`}
                    onClick={() => onSelectTool(t.id)}
                  >
                    <span className="rp-tool-item-name">{t.toolName}</span>
                    <span className="rp-tool-item-state">
                      {!t.done ? (
                        <Loader2 size={12} className="icon-spin" />
                      ) : t.isError ? (
                        <XCircle size={12} />
                      ) : (
                        <CheckCircle2 size={12} />
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="rp-tool-detail">
            {selected ? (
              <>
                <div className="rp-tool-detail-head">
                  <strong>{selected.toolName}</strong>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => void copyAll()}
                  >
                    <Copy size={12} />
                    {copied ? "已复制" : "复制"}
                  </button>
                </div>
                {detailTruncated && (
                  <div className="rp-banner-soft">
                    内容已达缓存上限，可能仍有截断。
                  </div>
                )}
                {detailError && (
                  <div className="rp-banner-soft">{detailError}</div>
                )}
                {detailArgs && (
                  <div className="rp-section">
                    <div className="rp-section-label">参数</div>
                    <pre>{detailArgs}</pre>
                  </div>
                )}
                {detailResult && (
                  <div
                    className={`rp-section${selected.isError ? " is-error" : ""}`}
                  >
                    <div className="rp-section-label">结果</div>
                    <pre>{detailResult}</pre>
                  </div>
                )}
                {!detailArgs && !detailResult && (
                  <div className="rp-empty">暂无参数/结果</div>
                )}
              </>
            ) : (
              <div className="rp-empty">选择左侧工具查看详情</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
