/** Make local diagnostic evidence inspectable and easy to submit without automatically uploading it. */
import { useEffect, useState } from "react";
import { Copy, Download, ExternalLink, RefreshCw } from "lucide-react";
import type { DiagnosticSnapshot } from "@shared/diagnostics";
import { diagnosticEventSummary, diagnosticFeedbackSummary, diagnosticTime } from "@shared/diagnostic-feedback";

const BUG_REPORT_URL = "https://github.com/Fromlan/X-agent/issues/new?template=bug.yml";

/** Load an allowlisted preview and preserve the last exported snapshot for matching copied feedback. */
export function DiagnosticsSettings({ open }: { open: boolean }) {
  const [report, setReport] = useState<DiagnosticSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    window.xAgent.appReport.getDiagnosticSnapshot().then((snapshot) => {
      if (active) { setReport(snapshot); setMessage(null); }
    }).catch(() => { if (active) setMessage("诊断信息读取失败，请点击刷新重试"); });
    return () => { active = false; };
  }, [open]);

  /** Refresh explicitly so a newly reproduced failure can be included in the preview and summary. */
  async function refresh() {
    setBusy(true);
    try { setReport(await window.xAgent.appReport.getDiagnosticSnapshot()); setMessage("诊断信息已刷新"); }
    catch { setMessage("诊断信息读取失败，请重试"); }
    finally { setBusy(false); }
  }

  /** Export locally through the existing trusted IPC; canceling the Windows dialog is a normal outcome. */
  async function exportReport() {
    setBusy(true);
    try {
      const result = await window.xAgent.appReport.exportDiagnosticBundle();
      if (result.ok) {
        if (result.snapshot) setReport(result.snapshot);
        setMessage("已导出本地诊断包。请复制反馈摘要，并在反馈页面附上诊断文件。");
      }
      else setMessage(result.canceled ? "已取消导出" : "诊断包导出失败，请重试");
    } catch { setMessage("诊断包导出失败，请检查保存位置权限"); }
    finally { setBusy(false); }
  }

  /** Copy only the visible safe summary; no authentication or project files are read. */
  async function copySummary() {
    if (!report) return;
    setBusy(true);
    try { await navigator.clipboard.writeText(diagnosticFeedbackSummary(report)); setMessage("已复制反馈摘要，请粘贴到反馈页面的「诊断信息 / 截图」中"); }
    catch { setMessage("复制失败，请展开诊断预览后手动复制"); }
    finally { setBusy(false); }
  }

  /** Open the existing Bug form without putting diagnostics in the URL or creating an Issue automatically. */
  async function openFeedback() {
    setBusy(true);
    try {
      const result = await window.xAgent.files.openExternal(BUG_REPORT_URL);
      setMessage(result.ok ? "已打开反馈页面，请补充问题描述、粘贴摘要并附上诊断文件。" : "反馈页面打开失败，请稍后重试");
    } catch { setMessage("反馈页面打开失败，请检查网络或默认浏览器"); }
    finally { setBusy(false); }
  }

  return (
    <div className="settings-block">
      <h4 className="settings-block-title">诊断与反馈</h4>
      {report?.lastFailure && (
        <p className="settings-hint">最近失败：{diagnosticTime(report.lastFailure.at)} · {diagnosticEventSummary(report.lastFailure)}</p>
      )}
      <div className="settings-inline-row">
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void exportReport()}><Download size={14} />导出诊断包</button>
        <button className="btn btn-ghost btn-sm" disabled={busy || !report} onClick={() => void copySummary()}><Copy size={14} />复制反馈摘要</button>
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void openFeedback()}><ExternalLink size={14} />反馈问题</button>
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void refresh()}><RefreshCw size={14} />刷新诊断</button>
      </div>
      {message && <p className="settings-hint" role="status">{message}</p>}
      {report && (
        <details className="diagnostics-preview">
          <summary>诊断预览（最近 {report.events.length} 条记录）</summary>
          <pre tabIndex={0}>{JSON.stringify(report, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}
