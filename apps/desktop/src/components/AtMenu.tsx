/**
 * @-补全菜单 —— 复用 SlashMenu 的样式与可访问性骨架。
 * 三类候选用统一的样式呈现，类别前缀在 label 中明示。
 */
import type { AtCandidate } from "../hooks/useAtCompletion";
import { atCategoryLabel } from "../lib/at-completion";

type Props = {
  open: boolean;
  candidates: AtCandidate[];
  highlightIndex: number;
  onHighlightChange: (index: number) => void;
  onSelect: (candidate: AtCandidate) => void;
  onClose: () => void;
};

export function AtMenu(props: Props) {
  if (!props.open) return null;

  const { candidates, highlightIndex } = props;
  const headerLabel =
    candidates[0] !== undefined
      ? `${atCategoryLabel(categoryOf(candidates[0]))}补全`
      : "补全";

  return (
    <div
      className="skill-slash-menu at-menu"
      role="listbox"
      aria-label="@ 补全"
      onMouseDown={(e) => {
        // Keep textarea focus; prevent blur-close before click select.
        e.preventDefault();
      }}
    >
      <div className="skill-slash-menu__header">{headerLabel}</div>
      {candidates.length === 0 ? (
        <div className="skill-slash-menu__empty">无匹配项</div>
      ) : (
        <ul className="skill-slash-menu__list">
          {candidates.map((candidate, i) => {
            const active = i === highlightIndex;
            const key = `${candidate.kind}:${candidate.id}`;
            const label =
              candidate.kind === "mode"
                ? `${candidate.label}（@mode:${candidate.id}）`
                : candidate.kind === "skill"
                  ? `${candidate.id}（@skill:${candidate.id}）`
                  : candidate.id;
            const hint =
              candidate.kind === "mode" ? candidate.hint : undefined;
            const description =
              candidate.kind === "skill"
                ? candidate.description
                : candidate.kind === "path"
                  ? "项目内相对路径"
                  : undefined;
            return (
              <li key={key} role="option" aria-selected={active}>
                <button
                  type="button"
                  className={
                    active
                      ? "skill-slash-menu__item is-active"
                      : "skill-slash-menu__item"
                  }
                  onMouseEnter={() => props.onHighlightChange(i)}
                  onClick={() => props.onSelect(candidate)}
                >
                  <span className="skill-slash-menu__row">
                    <span className="skill-slash-menu__name">{label}</span>
                    <span
                      className={`skill-slash-menu__kind skill-slash-menu__kind--${candidate.kind}`}
                    >
                      {atCategoryLabel(candidate.kind)}
                    </span>
                  </span>
                  {hint ? (
                    <span className="skill-slash-menu__hint">{hint}</span>
                  ) : null}
                  {description ? (
                    <span className="skill-slash-menu__desc">{description}</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="skill-slash-menu__footer">
        ↑↓ 选择 · Enter 插入 · Esc 关闭
      </div>
    </div>
  );
}

function categoryOf(c: AtCandidate): "path" | "skill" | "mode" {
  return c.kind;
}
