import { FilePlus2, FileText, ListChecks, Lightbulb } from "lucide-react";
import type { StageInfo } from "@shared/ipc";

interface Props {
  stageInfo: StageInfo;
  busy: boolean;
}

export function DesignTab({ stageInfo, busy }: Props) {
  const { definition, graduation, artifacts } = stageInfo;
  return (
    <div className="stage-tab">
      <header className="stage-tab-header">
        <Lightbulb size={16} aria-hidden />
        <h3>{definition.label}</h3>
      </header>
      <p className="stage-tab-description">{definition.description}</p>

      <section className="stage-tab-section">
        <h4>毕业条件</h4>
        <ul className="stage-checks">
          {graduation.checks.length === 0 && (
            <li className="stage-check-empty">暂无</li>
          )}
          {graduation.checks.map((c) => (
            <li key={c.id} className={c.passed ? "is-passed" : "is-pending"}>
              <ListChecks size={14} aria-hidden />
              <span className="stage-check-label">{c.label}</span>
              {c.detail && <span className="stage-check-detail">— {c.detail}</span>}
            </li>
          ))}
        </ul>
      </section>

      <section className="stage-tab-section">
        <h4>
          产物（{artifacts.totalFiles} 个，目录 <code>{artifacts.artifactsDir}</code>）
        </h4>
        {artifacts.files.length === 0 ? (
          <p className="stage-tab-empty">还没有文件，开始写第一份 GDD / 数据表吧。</p>
        ) : (
          <ul className="stage-files">
            {artifacts.files.slice(0, 20).map((f) => (
              <li key={f}>
                <FileText size={12} aria-hidden />
                <code>{f}</code>
              </li>
            ))}
            {artifacts.files.length > 20 && (
              <li className="stage-files-more">
                …另有 {artifacts.files.length - 20} 个文件
              </li>
            )}
          </ul>
        )}
        {busy && (
          <p className="stage-tab-hint">Agent 正在产出文件…</p>
        )}
      </section>

      <section className="stage-tab-section">
        <h4>引导提示</h4>
        <p className="stage-tab-hint">
          在对话中描述你的灵感；Agent 会扩展并写 GDD 到{" "}
          <code>{definition.label}</code> 目录。
        </p>
        <p className="stage-tab-hint">
          <FilePlus2 size={12} aria-hidden /> 可让 Agent 新建 01-gdd.md、02-systems.md 等模板。
        </p>
      </section>
    </div>
  );
}
