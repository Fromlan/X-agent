import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import {
  cacheHitRatio,
  formatCacheHitRatio,
} from "@shared/cache-hit";
import type { UsageSummary } from "@shared/ipc";
import { SettingsNotice, useAutoClearNotice } from "./SettingsNotice";
import { useConfirm } from "@/lib/app-confirm";

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

function formatCost(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function shortModelKey(key: string): { provider: string; model: string } {
  const i = key.indexOf("/");
  if (i <= 0) return { provider: "", model: key };
  return { provider: key.slice(0, i), model: key.slice(i + 1) };
}

interface Props {
  active: boolean;
}

export function UsageSettingsPage({ active }: Props) {
  const confirm = useConfirm();
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [view, setView] = useState<"days" | "models">("days");

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    setError(null);
    try {
      const data = await window.xAgent.getUsageSummary({ days: 30 });
      setSummary(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void refresh();
  }, [active, refresh]);

  useEffect(() => {
    if (active) return;
    setMsg(null);
    setError(null);
  }, [active]);

  useAutoClearNotice(msg, () => setMsg(null), 4500, !error);

  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = window.xAgent.onEvent((event) => {
      if (
        event.type !== "usage_update" &&
        event.type !== "compaction_end" &&
        event.type !== "assistant_end"
      ) {
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void refresh({ silent: true });
      }, 400);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, [active, refresh]);

  const onClear = async () => {
    const ok = await confirm({
      title: "清空用量统计",
      message:
        "确认清空本地用量统计？不会删除会话文件，仅清除按日/按模型汇总。",
      confirmLabel: "清空",
      tone: "danger",
    });
    if (!ok) return;
    setClearing(true);
    setMsg(null);
    setError(null);
    try {
      const result = await window.xAgent.clearUsageSummary();
      if (!result.ok) {
        setError(result.error ?? "清空失败");
        return;
      }
      setMsg("已清空本地用量统计");
      await refresh();
    } finally {
      setClearing(false);
    }
  };

  const hasDays = Boolean(summary && summary.days.length > 0);
  const hasModels = Boolean(summary && summary.byModel.length > 0);
  const totalsHitRatio = summary
    ? cacheHitRatio({
        input: summary.totals.tokens.input,
        cacheRead: summary.totals.tokens.cacheRead,
      })
    : null;

  return (
    <section className="settings-page usage-page">
      <div className="settings-page-head usage-page-head">
        <div>
          <h3>用量</h3>
          <p className="modal-hint">
            近 30 天本地统计 · 按日历日累计 · 费用依赖模型费率
          </p>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => void refresh()}
          disabled={loading}
          title="刷新"
        >
          <RefreshCw size={14} className={loading ? "icon-spin" : undefined} />
          刷新
        </button>
      </div>

      <div className="usage-hero">
        <div className="usage-hero-card">
          <span className="usage-hero-label">轮次</span>
          <span className="usage-hero-value">
            {summary ? summary.totals.turns : "—"}
          </span>
        </div>
        <div className="usage-hero-card">
          <span className="usage-hero-label">Tokens</span>
          <span className="usage-hero-value">
            {summary ? formatTokens(summary.totals.tokens.total) : "—"}
          </span>
        </div>
        <div className="usage-hero-card">
          <span className="usage-hero-label">缓存命中</span>
          <span className="usage-hero-value">
            {summary ? formatCacheHitRatio(totalsHitRatio) : "—"}
          </span>
        </div>
        <div className="usage-hero-card">
          <span className="usage-hero-label">费用</span>
          <span className="usage-hero-value">
            {summary ? formatCost(summary.totals.cost) : "—"}
          </span>
        </div>
      </div>

      <div className="settings-block usage-block">
        <div className="usage-view-toggle" role="tablist" aria-label="用量视图">
          <button
            type="button"
            role="tab"
            aria-selected={view === "days"}
            className={`usage-view-btn${view === "days" ? " active" : ""}`}
            onClick={() => setView("days")}
          >
            按日
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "models"}
            className={`usage-view-btn${view === "models" ? " active" : ""}`}
            onClick={() => setView("models")}
          >
            按模型
          </button>
        </div>

        {view === "days" &&
          (hasDays ? (
            <div className="usage-table-wrap">
              <table className="usage-table">
                <thead>
                  <tr>
                    <th>日期</th>
                    <th className="is-num">轮次</th>
                    <th className="is-num">Tokens</th>
                    <th className="is-num">命中率</th>
                    <th className="is-num">费用</th>
                  </tr>
                </thead>
                <tbody>
                  {[...summary!.days].reverse().map((day) => (
                    <tr key={day.date}>
                      <td className="is-date">{day.date}</td>
                      <td className="is-num">{day.turns}</td>
                      <td className="is-num">
                        {formatTokens(day.tokens.total)}
                      </td>
                      <td className="is-num">
                        {formatCacheHitRatio(
                          cacheHitRatio({
                            input: day.tokens.input,
                            cacheRead: day.tokens.cacheRead,
                          }),
                        )}
                      </td>
                      <td className="is-num">{formatCost(day.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="usage-empty">
              {loading
                ? "加载中…"
                : "近 30 天暂无记录 — 完成对话后会自动累计"}
            </p>
          ))}

        {view === "models" &&
          (hasModels ? (
            <div className="usage-table-wrap">
              <table className="usage-table">
                <thead>
                  <tr>
                    <th>模型</th>
                    <th className="is-num">轮次</th>
                    <th className="is-num">Tokens</th>
                    <th className="is-num">命中率</th>
                    <th className="is-num">费用</th>
                  </tr>
                </thead>
                <tbody>
                  {summary!.byModel.map((row) => {
                    const { provider, model } = shortModelKey(row.modelKey);
                    return (
                      <tr key={row.modelKey}>
                        <td title={row.modelKey}>
                          <div className="usage-model-cell">
                            <span className="usage-model-id">{model}</span>
                            {provider && (
                              <span className="usage-model-provider">
                                {provider}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="is-num">{row.turns}</td>
                        <td className="is-num">
                          {formatTokens(row.tokens.total)}
                        </td>
                        <td className="is-num">
                          {formatCacheHitRatio(
                            cacheHitRatio({
                              input: row.tokens.input,
                              cacheRead: row.tokens.cacheRead,
                            }),
                          )}
                        </td>
                        <td className="is-num">{formatCost(row.cost)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="usage-empty">
              {loading
                ? "加载中…"
                : "近 30 天暂无记录 — 完成对话后会自动累计"}
            </p>
          ))}
      </div>

      <div className="usage-danger">
        <div className="usage-danger-copy">
          <span className="usage-danger-title">清空统计</span>
          <span className="usage-danger-hint">
            仅清除本地汇总文件，不影响会话记录
          </span>
        </div>
        <button
          type="button"
          className="btn btn-danger btn-sm"
          disabled={clearing || loading}
          onClick={() => void onClear()}
        >
          <Trash2 size={14} />
          {clearing ? "清空中…" : "清空"}
        </button>
      </div>

      {(msg || error) && (
        <SettingsNotice
          text={(error ?? msg)!}
          tone={error ? "error" : "neutral"}
          onDismiss={() => {
            setMsg(null);
            setError(null);
          }}
        />
      )}
    </section>
  );
}
