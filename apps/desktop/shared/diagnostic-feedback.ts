/** Format the same safe support metadata for an on-screen preview and a user-reviewed Bug report. */
import type { DiagnosticEvent, DiagnosticSnapshot } from "./diagnostics";

const OUTCOME_LABELS = { started: "进行中", succeeded: "成功", failed: "失败", canceled: "已取消" } as const;

/** Display timestamps in the user's Windows locale, retaining timezone context in copied reports. */
export function diagnosticTime(at: number): string {
  return new Date(at).toLocaleString("zh-CN", { hour12: false, timeZoneName: "short" });
}

/** Render enum metadata without any user prompts, paths, tool arguments or raw error bodies. */
export function diagnosticEventSummary(event: DiagnosticEvent): string {
  const operation = event.tool ? `${event.operation}/${event.tool}` : event.operation ?? event.kind;
  const outcome = event.outcome ? OUTCOME_LABELS[event.outcome] : event.reason === "aborted" ? "已取消" : "异常";
  const duration = event.durationMs === undefined ? "" : ` · ${event.durationMs} ms`;
  return `${operation} · ${outcome} · ${event.reason}${duration}`;
}

/** Keep a paste-ready summary small; full bounded evidence remains in the separately exported JSON. */
export function diagnosticFeedbackSummary(report: DiagnosticSnapshot): string {
  const failure = report.lastFailure;
  return [
    "### 诊断摘要", `报告编号：${report.reportId}`, `生成时间：${diagnosticTime(report.generatedAt)}`,
    `X-agent：${report.appVersion}`, `系统：${report.platform} ${report.osRelease} (${report.architecture})`,
    `Electron：${report.electronVersion}；Node.js：${report.nodeVersion}`,
    `当前状态：${report.state.status}；模式：${report.state.mode}；Godot 连接数：${report.state.godotClients}`,
    "", "最近失败：",
    ...(failure ? [
      `${diagnosticTime(failure.at)} · ${diagnosticEventSummary(failure)}`,
      ...(failure.appVersion ? [`失败时 X-agent：${failure.appVersion}`] : []),
      `失败运行编号：${failure.runId ?? "旧版记录"}；操作编号：${failure.operationId ?? "旧版记录"}`,
      ...(failure.state ? [`失败时状态：${failure.state.status}；模式：${failure.state.mode}；Godot 连接数：${failure.state.godotClients}`] : []),
    ] : ["未记录到失败；请补充现象和复现步骤。"]),
    "", "最近操作（最多 10 条）：",
    ...report.events.slice(-10).map((event) => `- ${diagnosticTime(event.at)} · ${diagnosticEventSummary(event)}`),
    "", "请补充复现步骤、预期结果、实际结果和是否重复出现，并附上导出的诊断 JSON 或截图。",
    "诊断不包含原始错误、对话、源码、路径或密钥；此摘要由用户主动复制并提交。",
  ].join("\n");
}
