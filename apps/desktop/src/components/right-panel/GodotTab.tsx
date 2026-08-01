import { useEffect, useMemo, useState } from "react";
import type { GodotRpcStatusDto } from "@shared/ipc";
import type { ChatItem } from "../../stores/chat-store";
import { selectToolInPanel } from "../../stores/right-panel-store";

function formatMaybeJson(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

interface Props {
  active: boolean;
  items: ChatItem[];
}

export function GodotTab({ active, items }: Props) {
  const [status, setStatus] = useState<GodotRpcStatusDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [pingOut, setPingOut] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const s = await window.xAgent.godotRpcStatus();
      setStatus(s);
      setError(s.error ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    if (!active) return;
    void refresh();
    const id = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(id);
  }, [active]);

  const lastGodotTool = useMemo(() => {
    const tools = items.filter(
      (i): i is Extract<ChatItem, { kind: "tool" }> =>
        i.kind === "tool" &&
        i.toolName.startsWith("godot_") &&
        !i.toolName.startsWith("godot_docs_"),
    );
    return tools.length ? tools[tools.length - 1] : null;
  }, [items]);

  const startBridge = async () => {
    setBusy(true);
    try {
      const s = await window.xAgent.godotRpcStart();
      setStatus(s);
      setError(s.error ?? null);
    } finally {
      setBusy(false);
    }
  };

  const stopBridge = async () => {
    setBusy(true);
    try {
      await window.xAgent.godotRpcStop();
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const ping = async () => {
    setBusy(true);
    try {
      const res = await window.xAgent.godotRpcPing();
      setPingOut(
        res.ok
          ? formatMaybeJson(res.result)
          : res.error ?? "Ping 失败",
      );
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const setActiveClient = async (clientId: string | null) => {
    setBusy(true);
    try {
      const res = await window.xAgent.godotRpcSetActiveClient(clientId);
      setStatus(res.status);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rp-godot">
      <div className="rp-godot-actions">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy || status?.running}
          onClick={() => void startBridge()}
        >
          启动桥
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={busy || !status?.running}
          onClick={() => void stopBridge()}
        >
          停止
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={busy || !status?.running || (status?.clients ?? 0) < 1}
          onClick={() => void ping()}
        >
          Ping
        </button>
      </div>

      {error && <div className="rp-banner-soft">{error}</div>}
      {status?.warning && (
        <div className="rp-banner-soft">{status.warning}</div>
      )}

      <div className="rp-section">
        <div className="rp-section-label">桥状态</div>
        <div className="rp-kv">
          <span>运行中</span>
          <span>{status?.running ? "是" : "否"}</span>
        </div>
        <div className="rp-kv">
          <span>端口</span>
          <span className="tabular">{status?.port ?? "—"}</span>
        </div>
        <div className="rp-kv">
          <span>客户端数</span>
          <span className="tabular">{status?.clients ?? 0}</span>
        </div>
        <div className="rp-kv">
          <span>活动客户端</span>
          <span className="tabular">{status?.activeClientId ?? "（自动）"}</span>
        </div>
      </div>

      <div className="rp-section">
        <div className="rp-section-label">已连接编辑器</div>
        {(status?.clientInfos?.length ?? 0) === 0 ? (
          <div className="rp-empty">
            尚无客户端。请启用 RPC 并打开项目。
          </div>
        ) : (
          <ul className="rp-client-list">
            {status!.clientInfos.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={`rp-client-item${status?.activeClientId === c.id ? " active" : ""}`}
                  disabled={busy}
                  onClick={() => void setActiveClient(c.id)}
                >
                  <span className="rp-client-id">{c.id}</span>
                  <span className="rp-client-meta">
                    {c.godotVersion ?? "Godot"}
                    {c.projectPath ? ` · ${c.projectPath}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {pingOut && (
        <div className="rp-section">
          <div className="rp-section-label">Ping 结果</div>
          <pre>{pingOut}</pre>
        </div>
      )}

      <div className="rp-section">
        <div className="rp-section-label">最近 Agent Godot 工具</div>
        {lastGodotTool ? (
          <button
            type="button"
            className="rp-tool-item active"
            onClick={() => selectToolInPanel(lastGodotTool.id)}
          >
            <span className="rp-tool-item-name">{lastGodotTool.toolName}</span>
            <span className="rp-tool-item-state">
              {lastGodotTool.done
                ? lastGodotTool.isError
                  ? "失败"
                  : "完成"
                : "执行中"}
            </span>
          </button>
        ) : (
          <div className="rp-empty">本槽位尚无 godot_* 工具调用</div>
        )}
      </div>
    </div>
  );
}
