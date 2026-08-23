import { useEffect, useState } from "react";
import type { GameStage } from "@shared/game-stage";
import {
  GAME_STAGES,
  GAME_STAGE_DESCRIPTIONS,
  GAME_STAGE_LABELS,
} from "@shared/game-stage";

interface Props {
  cwd: string | null;
  stage: GameStage | null;
}

const STAGE_ARTIFACTS: Record<
  GameStage,
  { dirs: string[]; files: Array<{ dir: string; name: string }> }
> = {
  planning: {
    dirs: [".game/design", ".game/config"],
    files: [
      { dir: ".game/design", name: "01-gdd.md" },
      { dir: ".game/config", name: "gameplay.json" },
    ],
  },
  prototype: {
    dirs: [".game/prototype"],
    files: [{ dir: ".game/prototype", name: "NOTES.md" }],
  },
  testing: {
    dirs: [".game/test"],
    files: [
      { dir: ".game/test", name: "bugs.md" },
      { dir: ".game/test", name: "playtest-checklist.md" },
    ],
  },
  expansion: {
    dirs: [".game/backlog"],
    files: [{ dir: ".game/backlog", name: "expansion.md" }],
  },
};

/** Right-panel stage workbench. Shows real stage artifacts and guidance. */
export function GameStageTab({ cwd, stage }: Props) {
  const [files, setFiles] = useState<Array<{ dir: string; name: string }>>([]);
  const [markdown, setMarkdown] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!cwd || !stage) {
      setFiles([]);
      setMarkdown({});
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const meta = STAGE_ARTIFACTS[stage];
      const allFiles: Array<{ dir: string; name: string }> = [];
      for (const dir of meta.dirs) {
        const list = await window.xAgent.listProjectDir(dir);
        if (cancelled) return;
        if (list.ok && list.entries) {
          for (const e of list.entries) {
            allFiles.push({ dir, name: e.name });
          }
        }
      }
      if (cancelled) return;
      setFiles(allFiles);
      const docs: Record<string, string> = {};
      for (const f of meta.files) {
        const res = await window.xAgent.readProjectFile(`${f.dir}/${f.name}`);
        if (cancelled) return;
        if (res.ok && res.content) docs[f.name] = res.content;
      }
      if (!cancelled) setMarkdown(docs);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [cwd, stage]);

  return (
    <div className="game-stage-tab">
      <h3 className="rp-section-title">游戏阶段</h3>
      {!stage ? (
        <p className="rp-muted">尚未进入游戏开发流程。选择「策划」开始。</p>
      ) : (
        <>
          <p className="rp-muted">{GAME_STAGE_DESCRIPTIONS[stage]}</p>
          <ol className="game-stage-flow">
            {GAME_STAGES.map((s) => (
              <li key={s} className={s === stage ? "is-current" : ""}>
                <span>{GAME_STAGE_LABELS[s]}</span>
                <small>{GAME_STAGE_DESCRIPTIONS[s]}</small>
              </li>
            ))}
          </ol>
          <section className="game-stage-artifacts">
            <h4 className="rp-section-title">当前阶段产物</h4>
            {loading ? (
              <p className="rp-muted">读取中…</p>
            ) : (
              <>
                {files.length > 0 ? (
                  <ul className="game-stage-file-list">
                    {files.map((f) => (
                      <li key={`${f.dir}/${f.name}`}>
                        <code>{f.dir.replace(".game/", "")}/{f.name}</code>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rp-muted">尚未生成产物，切换阶段会自动初始化。</p>
                )}
                {Object.entries(markdown).map(([name, content]) => (
                  <details key={name} className="game-stage-doc">
                    <summary>{name}</summary>
                    <pre className="game-stage-doc-preview">{content}</pre>
                  </details>
                ))}
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
