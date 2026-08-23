import { Box, CheckSquare, FileText, ListChecks, Square } from "lucide-react";
import type { StageInfo } from "@shared/ipc";

interface Props {
  stageInfo: StageInfo;
  busy: boolean;
  onToggleCheck: (checkId: string, value: boolean) => void;
}

export function PrototypeTab({ stageInfo, busy, onToggleCheck }: Props) {
  const { definition, graduation, artifacts } = stageInfo;
  return (
    <div className="stage-tab">
      <header className="stage-tab-header">
        <Box size={16} aria-hidden />
        <h3>{definition.label}</h3>
      </header>
      <p className="stage-tab-description">{definition.description}</p>

      <section className="stage-tab-section">
        <h4>核心循环清单（{graduation.passed}/{graduation.total}）</h4>
        <ul className="stage-checks">
          {graduation.checks.map((c) => (
            <li key={c.id} className={c.passed ? "is-passed" : "is-pending"}>
              <button
                type="button"
                className="stage-check-toggle"
                disabled={busy}
                onClick={() => onToggleCheck(c.id, !c.passed)}
                aria-pressed={c.passed}
                aria-label={c.passed ? "取消勾选" : "勾选"}
              >
                {c.passed ? (
                  <CheckSquare size={14} aria-hidden />
                ) : (
                  <Square size={14} aria-hidden />
                )}
              </button>
              <span className="stage-check-label">{c.label}</span>
            </li>
          ))}
        </ul>
        {graduation.total === 0 && (
          <p className="stage-tab-empty">该阶段无需毕业条件</p>
        )}
      </section>

      <section className="stage-tab-section">
        <h4>
          原型文件（{artifacts.totalFiles} 个，目录 <code>{artifacts.artifactsDir}</code>）
        </h4>
        {artifacts.files.length === 0 ? (
          <p className="stage-tab-empty">
            <ListChecks size={12} aria-hidden /> 还没建任何文件，先在对话里拆方案再开干。
          </p>
        ) : (
          <ul className="stage-files">
            {artifacts.files.slice(0, 30).map((f) => (
              <li key={f}>
                <FileText size={12} aria-hidden />
                <code>{f}</code>
              </li>
            ))}
            {artifacts.files.length > 30 && (
              <li className="stage-files-more">
                …另有 {artifacts.files.length - 30} 个文件
              </li>
            )}
          </ul>
        )}
      </section>
    </div>
  );
}
