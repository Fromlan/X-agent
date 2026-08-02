import type { SessionSlashItem } from "@shared/ipc";
import { slashSourceLabel } from "../lib/slash-menu";

type Props = {
  open: boolean;
  items: SessionSlashItem[];
  query: string;
  highlightIndex: number;
  onHighlightChange: (index: number) => void;
  onSelect: (item: SessionSlashItem) => void;
  onClose: () => void;
};

export function SlashMenu(props: Props) {
  if (!props.open) return null;

  const { items, highlightIndex } = props;

  return (
    <div
      className="skill-slash-menu"
      role="listbox"
      aria-label="选择斜杠命令"
      onMouseDown={(e) => {
        // Keep textarea focus; prevent blur-close before click select.
        e.preventDefault();
      }}
    >
      {items.length === 0 ? (
        <div className="skill-slash-menu__empty">无匹配项</div>
      ) : (
        <ul className="skill-slash-menu__list">
          {items.map((item, i) => {
            const active = i === highlightIndex;
            const key = `${item.source}:${item.name}`;
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
                  onClick={() => props.onSelect(item)}
                >
                  <span className="skill-slash-menu__row">
                    <span className="skill-slash-menu__name">{item.name}</span>
                    <span
                      className={`skill-slash-menu__kind skill-slash-menu__kind--${item.source}`}
                    >
                      {slashSourceLabel(item.source)}
                    </span>
                  </span>
                  {item.argumentHint ? (
                    <span className="skill-slash-menu__hint">
                      {item.argumentHint}
                    </span>
                  ) : null}
                  {item.description ? (
                    <span className="skill-slash-menu__desc">
                      {item.description}
                    </span>
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
