import type { SidebarState } from "./useSidebarState";

interface Props {
  state: SidebarState;
  busy: boolean;
  locked: boolean;
  renaming: boolean;
}

export function SidebarItemMenu({ state, busy, locked, renaming }: Props) {
  const { menu, menuRef, runSessionMenu, runProjectMenu } = state;
  if (!menu) return null;
  return (
    <div
      ref={menuRef}
      className="rp-context-menu"
      style={{ left: menu.x, top: menu.y }}
      role="menu"
    >
      {menu.kind === "session" ? (
        <>
          <button
            type="button"
            className="rp-context-menu-item"
            role="menuitem"
            disabled={busy || renaming}
            onClick={() => runSessionMenu("rename")}
          >
            重命名
          </button>
          <div className="rp-context-menu-sep" />
          <button
            type="button"
            className="rp-context-menu-item is-danger"
            role="menuitem"
            disabled={busy || renaming || locked}
            onClick={() => runSessionMenu("delete")}
          >
            删除
          </button>
        </>
      ) : (
        <>
          {menu.key !== "" && (
            <>
              <button
                type="button"
                className="rp-context-menu-item"
                role="menuitem"
                disabled={busy || renaming}
                onClick={() => runProjectMenu("archive")}
              >
                归档项目
              </button>
              <div className="rp-context-menu-sep" />
            </>
          )}
          <button
            type="button"
            className="rp-context-menu-item is-danger"
            role="menuitem"
            disabled={busy || renaming || locked}
            onClick={() => runProjectMenu("deleteAll")}
          >
            删除全部对话
          </button>
        </>
      )}
    </div>
  );
}