import type { SessionSkillInfo } from "@shared/ipc";

type Props = {
  open: boolean;
  skills: SessionSkillInfo[];
  query: string;
  highlightIndex: number;
  onHighlightChange: (index: number) => void;
  onSelect: (skill: SessionSkillInfo) => void;
  onClose: () => void;
};

export function SkillSlashMenu(props: Props) {
  if (!props.open) return null;

  const { skills, highlightIndex } = props;

  return (
    <div
      className="skill-slash-menu"
      role="listbox"
      aria-label="选择技能"
      onMouseDown={(e) => {
        // Keep textarea focus; prevent blur-close before click select.
        e.preventDefault();
      }}
    >
      {skills.length === 0 ? (
        <div className="skill-slash-menu__empty">无匹配技能</div>
      ) : (
        <ul className="skill-slash-menu__list">
          {skills.map((skill, i) => {
            const active = i === highlightIndex;
            return (
              <li key={skill.name} role="option" aria-selected={active}>
                <button
                  type="button"
                  className={
                    active
                      ? "skill-slash-menu__item is-active"
                      : "skill-slash-menu__item"
                  }
                  onMouseEnter={() => props.onHighlightChange(i)}
                  onClick={() => props.onSelect(skill)}
                >
                  <span className="skill-slash-menu__name">{skill.name}</span>
                  {skill.description ? (
                    <span className="skill-slash-menu__desc">
                      {skill.description}
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
