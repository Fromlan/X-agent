/**
 * Sidebar 业务状态:编辑中菜单 / 折叠集合 / 上下文菜单 / 重命名提交。
 * 抽到独立 hook 让 Sidebar.tsx 顶层壳只渲染与组合子组件。
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { SessionInfo } from "@shared/ipc";
import {
  filterVisibleProjectGroups,
  groupSessionsByProject,
  normalizeProjectKey,
} from "@/lib/group-sessions";
import { useConfirm } from "@/lib/app-confirm";

export type ContextMenuState =
  | {
      kind: "session";
      x: number;
      y: number;
      session: SessionInfo;
    }
  | {
      kind: "project";
      x: number;
      y: number;
      key: string;
      cwd: string;
      label: string;
      sessionCount: number;
    };

export interface SidebarStateOpts {
  sessions: SessionInfo[];
  hiddenProjectKeys: string[];
  activeSessionId: string | null;
  activeCwd: string | null;
  busy: boolean;
  renaming?: boolean;
  onDelete: (path: string) => void;
  onDeleteProjectSessions: (cwd: string) => void;
  onHideProject: (cwd: string, label: string) => void;
  onRename: (path: string, name: string) => void | Promise<void>;
}

export function useSidebarState(opts: SidebarStateOpts) {
  const {
    sessions,
    hiddenProjectKeys,
    activeSessionId,
    activeCwd,
    busy,
    renaming: externalRenaming = false,
    onDelete,
    onDeleteProjectSessions,
    onHideProject,
    onRename,
  } = opts;
  const confirm = useConfirm();
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const groups = useMemo(
    () =>
      filterVisibleProjectGroups(
        groupSessionsByProject(sessions),
        hiddenProjectKeys,
      ),
    [sessions, hiddenProjectKeys],
  );

  const keysToExpand = useMemo(() => {
    const keys = new Set<string>();
    if (activeCwd) keys.add(normalizeProjectKey(activeCwd));
    if (activeSessionId) {
      const match = sessions.find((s) => s.id === activeSessionId);
      if (match) keys.add(normalizeProjectKey(match.cwd));
    }
    return keys;
  }, [activeCwd, activeSessionId, sessions]);

  useEffect(() => {
    if (keysToExpand.size === 0) return;
    setCollapsed((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const key of keysToExpand) {
        if (next.has(key)) {
          next.delete(key);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [keysToExpand]);

  useEffect(() => {
    if (editingPath) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editingPath]);

  const closeMenu = useCallback(() => setMenu(null), []);

  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return;
    const el = menuRef.current;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let x = menu.x;
    let y = menu.y;
    if (x + rect.width > window.innerWidth - pad) {
      x = Math.max(pad, window.innerWidth - rect.width - pad);
    }
    if (y + rect.height > window.innerHeight - pad) {
      y = Math.max(pad, window.innerHeight - rect.height - pad);
    }
    if (x !== menu.x || y !== menu.y) {
      setMenu((m) => (m ? { ...m, x, y } : m));
    }
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    const onPointer = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      closeMenu();
    };
    const onScroll = () => closeMenu();
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    listRef.current?.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
      listRef.current?.removeEventListener("scroll", onScroll);
    };
  }, [menu, closeMenu]);

  const startEdit = useCallback(
    (s: SessionInfo) => {
      if (busy || renaming || externalRenaming) return;
      setEditingPath(s.path);
      setDraftName(s.name);
    },
    [busy, externalRenaming, renaming],
  );

  const cancelEdit = useCallback(() => {
    if (renaming) return;
    setEditingPath(null);
    setDraftName("");
  }, [renaming]);

  const commitEdit = useCallback(
    async (path: string) => {
      const next = draftName.trim();
      if (!next) {
        cancelEdit();
        return;
      }
      const current = sessions.find((s) => s.path === path);
      if (current && current.name === next) {
        cancelEdit();
        return;
      }
      setRenaming(true);
      try {
        await onRename(path, next);
        setEditingPath(null);
        setDraftName("");
      } finally {
        setRenaming(false);
      }
    },
    [cancelEdit, draftName, onRename, sessions],
  );

  const onEditKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>, path: string) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void commitEdit(path);
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancelEdit();
      }
    },
    [cancelEdit, commitEdit],
  );

  const toggleGroup = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const openSessionMenu = useCallback(
    (s: SessionInfo, e: ReactMouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (busy || renaming) return;
      setMenu({
        kind: "session",
        x: e.clientX,
        y: e.clientY,
        session: s,
      });
    },
    [busy, renaming],
  );

  const openProjectMenu = useCallback(
    (
      group: { key: string; cwd: string; label: string; sessions: SessionInfo[] },
      e: ReactMouseEvent,
    ) => {
      e.preventDefault();
      e.stopPropagation();
      if (busy || renaming) return;
      setMenu({
        kind: "project",
        x: e.clientX,
        y: e.clientY,
        key: group.key,
        cwd: group.cwd,
        label: group.label,
        sessionCount: group.sessions.length,
      });
    },
    [busy, renaming],
  );

  const runSessionMenu = useCallback(
    async (action: "rename" | "delete") => {
      if (!menu || menu.kind !== "session") return;
      const { session } = menu;
      closeMenu();
      if (action === "rename") {
        startEdit(session);
        return;
      }
      const ok = await confirm({
        title: "删除会话",
        message: `删除会话「${session.name}」？`,
        confirmLabel: "删除",
        tone: "danger",
      });
      if (ok) onDelete(session.path);
    },
    [closeMenu, confirm, menu, onDelete, startEdit],
  );

  const runProjectMenu = useCallback(
    async (action: "archive" | "deleteAll") => {
      if (!menu || menu.kind !== "project") return;
      const { key, cwd, label, sessionCount } = menu;
      closeMenu();
      if (action === "archive") {
        if (key === "") return;
        const ok = await confirm({
          title: "归档项目",
          message: `归档项目「${label}」？\n会话文件不会删除，再次打开该项目后会重新出现。`,
          confirmLabel: "归档",
          tone: "warn",
        });
        if (ok) onHideProject(cwd, label);
        return;
      }
      const ok = await confirm({
        title: "删除项目对话",
        message: `删除「${label}」下的全部 ${sessionCount} 个对话？\n此操作不可恢复。`,
        confirmLabel: "全部删除",
        tone: "danger",
      });
      if (ok) onDeleteProjectSessions(cwd);
    },
    [closeMenu, confirm, menu, onDeleteProjectSessions, onHideProject],
  );

  const activeKey = activeCwd ? normalizeProjectKey(activeCwd) : "";
  const menuOpen = Boolean(menu);

  return {
    groups,
    collapsed,
    toggleGroup,
    editingPath,
    draftName,
    setDraftName,
    renaming,
    inputRef,
    menuRef,
    listRef,
    menu,
    menuOpen,
    activeKey,
    openSessionMenu,
    openProjectMenu,
    runSessionMenu,
    runProjectMenu,
    startEdit,
    cancelEdit,
    commitEdit,
    onEditKeyDown,
  };
}

export type SidebarState = ReturnType<typeof useSidebarState>;