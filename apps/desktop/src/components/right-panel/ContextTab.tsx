import { useEffect, useState } from "react";
import { Loader2, Minimize2 } from "lucide-react";
import type { ContextSegmentId, SessionUsageSnapshot } from "@shared/ipc";

function formatTokens(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

function formatCost(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function formatPercent(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n < 10 ? n.toFixed(1) : n.toFixed(0)}%`;
}

const SEGMENT_ORDER: ContextSegmentId[] = [
  "system",
  "project",
  "skills",
  "tools",
  "messages",
  "overhead",
];

interface Props {
  usage: SessionUsageSnapshot | null;
  compacting: boolean;
  busy: boolean;
  /** Clears local compact hint/error when the active session changes. */
  sessionId: string | null;
}

export function ContextTab({ usage, compacting, busy, sessionId }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    setHint(null);
  }, [sessionId]);

  const context = usage?.context ?? null;
  const percent = context?.percent ?? null;
  const tokens = context?.tokens ?? null;
  const windowSize = context?.contextWindow ?? 0;
  const fill = percent != null ? Math.max(0, Math.min(100, percent)) : 0;
  const isHigh = percent != null && percent >= 85;
  const isWarn = percent != null && percent >= 70 && !isHigh;

  const segments = [...(context?.segments ?? [])].sort(
    (a, b) => SEGMENT_ORDER.indexOf(a.id) - SEGMENT_ORDER.indexOf(b.id),
  );
  const segmentTotal = segments.reduce((s, seg) => s + seg.tokens, 0) || 1;

  const lastTurn = usage?.lastTurn ?? null;
  const turnInput = lastTurn?.tokens.input ?? 0;
  const turnOutput = lastTurn?.tokens.output ?? 0;
  const turnCache =
    (lastTurn?.tokens.cacheRead ?? 0) + (lastTurn?.tokens.cacheWrite ?? 0);
  const turnTotal = lastTurn
    ? lastTurn.tokens.total || turnInput + turnOutput + turnCache
    : 0;

  const onCompact = async () => {
    setError(null);
    setHint(null);
    const result = await window.xAgent.compactSession();
    if (!result.ok) {
      setError(result.error ?? "压缩失败");
      return;
    }
    const before = result.tokensBefore;
    const after = result.estimatedTokensAfter;
    if (before != null && after != null) {
      setHint(`已压缩 ${formatTokens(before)} → ${formatTokens(after)}`);
    } else if (before != null) {
      setHint(`已压缩（前 ${formatTokens(before)}）`);
    } else {
      setHint("上下文已压缩");
    }
  };

  return (
    <div className="rp-context">
      <section className="rp-context-hero">
        <div className="rp-context-hero-top">
          <div className="rp-context-hero-copy">
            <span className="rp-context-kicker">上下文占用</span>
            <div
              className={`rp-context-hero-value${isHigh ? " is-high" : isWarn ? " is-warn" : ""}`}
            >
              {formatPercent(percent)}
            </div>
            <div className="rp-context-hero-sub">
              <span className="rp-context-num">
                {formatTokens(tokens)}
              </span>
              <span className="rp-context-sep">/</span>
              <span>{formatTokens(windowSize || null)} tokens</span>
            </div>
          </div>
        </div>

        <div
          className={`rp-context-track${percent == null ? " is-unknown" : ""}`}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent != null ? Math.round(percent) : undefined}
          aria-label="上下文占用比例"
        >
          <div
            className={`rp-context-track-fill${isHigh ? " is-high" : isWarn ? " is-warn" : ""}`}
            style={{ width: percent != null ? `${fill}%` : "0%" }}
          />
        </div>

        {percent == null && (
          <p className="rp-context-hint">
            占用暂未知 — 压缩后需下一轮回复才会更新
          </p>
        )}
      </section>

      <section className="rp-context-section">
        <div className="rp-context-section-head">
          <h3 className="rp-context-label">组成拆解</h3>
          <span className="rp-context-badge">估算</span>
        </div>

        {segments.length > 0 ? (
          <>
            <div className="rp-context-stack" aria-hidden>
              {segments.map((seg) => {
                const pct = (seg.tokens / segmentTotal) * 100;
                if (pct <= 0) return null;
                return (
                  <span
                    key={seg.id}
                    className={`rp-context-stack-seg is-${seg.id}`}
                    style={{ width: `${pct}%` }}
                    title={`${seg.label}: ${formatTokens(seg.tokens)}`}
                  />
                );
              })}
            </div>
            <ul className="rp-context-legend">
              {segments.map((seg) => {
                const pct = (seg.tokens / segmentTotal) * 100;
                return (
                  <li key={seg.id} className="rp-context-legend-row">
                    <span className={`rp-context-dot is-${seg.id}`} aria-hidden />
                    <span className="rp-context-legend-name">{seg.label}</span>
                    <span className="rp-context-legend-pct">
                      {pct < 1 && seg.tokens > 0
                        ? "<1%"
                        : `${pct.toFixed(0)}%`}
                    </span>
                    <span className="rp-context-legend-tokens">
                      {formatTokens(seg.tokens)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <p className="rp-context-empty">打开会话后显示占用拆解</p>
        )}
      </section>

      <section className="rp-context-section">
        <div className="rp-context-section-head">
          <h3 className="rp-context-label">本轮用量</h3>
          <span className="rp-context-badge">API</span>
        </div>
        {lastTurn && turnTotal > 0 ? (
          <>
            <div className="rp-context-turn-stack" aria-hidden>
              {turnInput > 0 && (
                <span
                  className="rp-context-turn-seg is-input"
                  style={{ width: `${(turnInput / turnTotal) * 100}%` }}
                />
              )}
              {turnOutput > 0 && (
                <span
                  className="rp-context-turn-seg is-output"
                  style={{ width: `${(turnOutput / turnTotal) * 100}%` }}
                />
              )}
              {turnCache > 0 && (
                <span
                  className="rp-context-turn-seg is-cache"
                  style={{ width: `${(turnCache / turnTotal) * 100}%` }}
                />
              )}
            </div>
            <div className="rp-context-metrics">
              <div className="rp-context-metric">
                <span className="rp-context-metric-label">Input</span>
                <span className="rp-context-metric-value">
                  {formatTokens(turnInput)}
                </span>
              </div>
              <div className="rp-context-metric">
                <span className="rp-context-metric-label">Output</span>
                <span className="rp-context-metric-value">
                  {formatTokens(turnOutput)}
                </span>
              </div>
              <div className="rp-context-metric">
                <span className="rp-context-metric-label">Cache</span>
                <span className="rp-context-metric-value">
                  {formatTokens(turnCache)}
                </span>
              </div>
              <div className="rp-context-metric">
                <span className="rp-context-metric-label">费用</span>
                <span className="rp-context-metric-value">
                  {formatCost(lastTurn.cost.total)}
                </span>
              </div>
            </div>
          </>
        ) : (
          <p className="rp-context-empty">完成一轮对话后更新</p>
        )}
      </section>

      <section className="rp-context-section">
        <div className="rp-context-section-head">
          <h3 className="rp-context-label">本会话累计</h3>
        </div>
        {usage ? (
          <div className="rp-context-metrics">
            <div className="rp-context-metric">
              <span className="rp-context-metric-label">Input</span>
              <span className="rp-context-metric-value">
                {formatTokens(usage.tokens.input)}
              </span>
            </div>
            <div className="rp-context-metric">
              <span className="rp-context-metric-label">Output</span>
              <span className="rp-context-metric-value">
                {formatTokens(usage.tokens.output)}
              </span>
            </div>
            <div className="rp-context-metric">
              <span className="rp-context-metric-label">Cache</span>
              <span className="rp-context-metric-value">
                {formatTokens(
                  usage.tokens.cacheRead + usage.tokens.cacheWrite,
                )}
              </span>
            </div>
            <div className="rp-context-metric">
              <span className="rp-context-metric-label">费用</span>
              <span className="rp-context-metric-value">
                {formatCost(usage.cost)}
              </span>
            </div>
            <div className="rp-context-metric">
              <span className="rp-context-metric-label">对话轮次</span>
              <span className="rp-context-metric-value">
                {usage.userMessages}
                <span className="rp-context-metric-soft">
                  {" "}
                  / {usage.assistantMessages}
                </span>
              </span>
            </div>
            <div className="rp-context-metric">
              <span className="rp-context-metric-label">工具调用</span>
              <span className="rp-context-metric-value">
                {usage.toolCalls}
              </span>
            </div>
          </div>
        ) : (
          <p className="rp-context-empty">暂无用量数据</p>
        )}
        <p className="rp-context-footnote">
          费用依赖模型费率；自定义供应商未配置时多为 $0
        </p>
      </section>

      <div className="rp-context-footer">
        <button
          type="button"
          className="btn btn-secondary btn-sm rp-context-compact-btn"
          disabled={busy || compacting || !usage}
          onClick={() => void onCompact()}
        >
          {compacting ? (
            <Loader2 size={14} className="icon-spin" />
          ) : (
            <Minimize2 size={14} />
          )}
          {compacting ? "压缩中…" : "压缩上下文"}
        </button>
        {error && <p className="rp-context-error">{error}</p>}
        {hint && !error && <p className="rp-context-hint">{hint}</p>}
      </div>
    </div>
  );
}
