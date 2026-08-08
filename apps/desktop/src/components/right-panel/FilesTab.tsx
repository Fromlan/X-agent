import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  RefreshCw,
} from "lucide-react";
import { setPreviewPath } from "../../stores/right-panel-store";
import { joinProjectAbs } from "../../lib/group-sessions";
import { MarkdownBody } from "../MarkdownBody";

type DirEntry = { name: string; isDir: boolean };

function isMarkdownPath(relPath: string | null): boolean {
  if (!relPath) return false;
  return /\.(md|mdx|markdown)$/i.test(relPath.replace(/\\/g, "/"));
}

type ContextMenuState = {
  x: number;
  y: number;
  relPath: string;
};

interface TreeNodeProps {
  cwdReady: boolean;
  relDir: string;
  depth: number;
  selectedPath: string | null;
  onSelectFile: (relPath: string) => void;
  onContextPath: (
    relPath: string,
    e: ReactMouseEvent,
    isDir: boolean,
  ) => void;
}

function joinRel(dir: string, name: string): string {
  if (!dir) return name;
  return `${dir.replace(/\/+$/, "")}/${name}`;
}

function TreeNode({
  cwdReady,
  relDir,
  depth,
  selectedPath,
  onSelectFile,
  onContextPath,
}: TreeNodeProps) {
  const [open, setOpen] = useState(depth === 0);
  const [entries, setEntries] = useState<DirEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!cwdReady) return;
    setLoading(true);
    setError(null);
    try {
      const res = await window.xAgent.listProjectDir(relDir);
      if (!res.ok) {
        setError(res.error ?? "列出目录失败");
        setEntries([]);
        return;
      }
      setEntries(res.entries ?? []);
    } catch {
      // D10: IPC 异常（如项目切换中）时展示错误态，避免 unhandled rejection。
      setError("读取目录失败");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [cwdReady, relDir]);

  useEffect(() => {
    if (open && entries === null) void load();
  }, [open, entries, load]);

  if (!cwdReady) return null;

  return (
    <div className="rp-tree-node" style={{ paddingLeft: depth === 0 ? 0 : 12 }}>
      {depth > 0 && (
        <button
          type="button"
          className={`rp-tree-row is-dir${selectedPath === relDir ? " active" : ""}`}
          onClick={() => setOpen((v) => !v)}
          onContextMenu={(e) => onContextPath(relDir, e, true)}
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {open ? <FolderOpen size={12} /> : <Folder size={12} />}
          <span>{relDir.split("/").pop()}</span>
        </button>
      )}
      {depth === 0 && (
        <div className="rp-tree-root-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setEntries(null);
              setOpen(true);
            }}
            title="刷新"
          >
            <RefreshCw size={12} />
            刷新
          </button>
        </div>
      )}
      {open && (
        <div className="rp-tree-children">
          {loading && <div className="rp-empty">加载中…</div>}
          {error && <div className="rp-banner-soft">{error}</div>}
          {entries?.map((e) => {
            const childPath = joinRel(relDir, e.name);
            if (e.isDir) {
              return (
                <TreeNode
                  key={childPath}
                  cwdReady={cwdReady}
                  relDir={childPath}
                  depth={depth + 1}
                  selectedPath={selectedPath}
                  onSelectFile={onSelectFile}
                  onContextPath={onContextPath}
                />
              );
            }
            return (
              <button
                key={childPath}
                type="button"
                className={`rp-tree-row${selectedPath === childPath ? " active" : ""}`}
                onClick={() => onSelectFile(childPath)}
                onContextMenu={(ev) => onContextPath(childPath, ev, false)}
              >
                <span className="rp-tree-spacer" />
                <FileText size={12} />
                <span>{e.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface Props {
  cwd: string | null;
  previewPath: string | null;
  onAddPathToChat: (relPath: string) => void;
}

export function FilesTab({ cwd, previewPath, onAddPathToChat }: Props) {
  const [content, setContent] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mdSource, setMdSource] = useState(false);
  const [previewTruncated, setPreviewTruncated] = useState(false);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const markdown = isMarkdownPath(previewPath);

  useEffect(() => {
    setMdSource(false);
  }, [previewPath]);

  useEffect(() => {
    let cancelled = false;
    if (!cwd || !previewPath) {
      setContent("");
      setError(null);
      setPreviewTruncated(false);
      return;
    }
    setLoading(true);
    setError(null);
    setPreviewTruncated(false);
    void window.xAgent.readProjectFile(previewPath).then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (!res.ok) {
        setContent("");
        setError(res.error ?? "读取失败");
        return;
      }
      setContent(res.content ?? "");
      // D12: 大文件预览被截断时提示（与工具详情面板行为一致）。
      setPreviewTruncated(Boolean(res.truncated));
      setError(null);
    });
    return () => {
      cancelled = true;
    };
  }, [cwd, previewPath]);

  const closeMenu = useCallback(() => setMenu(null), []);

  const selectionLocked = Boolean(menu);
  /** While the context menu is open, highlight stays on the menu target. */
  const highlightPath = menu?.relPath ?? previewPath;

  const onContextPath = useCallback(
    (relPath: string, e: ReactMouseEvent, isDir: boolean) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isDir) setPreviewPath(relPath);
      setMenu({ x: e.clientX, y: e.clientY, relPath });
    },
    [],
  );

  const onSelectFile = useCallback(
    (path: string) => {
      if (selectionLocked) return;
      setPreviewPath(path);
    },
    [selectionLocked],
  );

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
    treeRef.current?.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
      treeRef.current?.removeEventListener("scroll", onScroll);
    };
  }, [menu, closeMenu]);

  const runMenu = async (
    action: "add" | "reveal" | "copyAbs" | "copyRel",
  ) => {
    if (!menu || !cwd) return;
    const { relPath } = menu;
    closeMenu();
    if (action === "add") {
      onAddPathToChat(relPath);
      return;
    }
    if (action === "reveal") {
      await window.xAgent.revealInFolder(relPath);
      return;
    }
    if (action === "copyAbs") {
      await navigator.clipboard.writeText(joinProjectAbs(cwd, relPath));
      return;
    }
    await navigator.clipboard.writeText(relPath.replace(/\\/g, "/"));
  };

  if (!cwd) {
    return <div className="rp-empty">请先打开项目文件夹</div>;
  }

  return (
    <div className={`rp-files${selectionLocked ? " is-context-menu-open" : ""}`}>
      <div
        className={`rp-files-tree${selectionLocked ? " is-menu-open" : ""}`}
        ref={treeRef}
      >
        <TreeNode
          cwdReady={Boolean(cwd)}
          relDir=""
          depth={0}
          selectedPath={highlightPath}
          onSelectFile={onSelectFile}
          onContextPath={onContextPath}
        />
      </div>
      <div className="rp-files-preview">
        <div className="rp-files-preview-head">
          <span className="rp-files-path" title={previewPath ?? ""}>
            {previewPath ?? "未选择文件"}
          </span>
          <div className="rp-files-preview-actions">
            {previewPath && markdown && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setMdSource((v) => !v)}
                title={mdSource ? "切换为渲染预览" : "切换为源码"}
              >
                {mdSource ? "渲染" : "源码"}
              </button>
            )}
            {previewPath && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => void window.xAgent.revealInFolder(previewPath)}
              >
                在资源管理器中显示
              </button>
            )}
          </div>
        </div>
        {loading && <div className="rp-empty">读取中…</div>}
        {error && <div className="rp-banner-soft">{error}</div>}
        {previewTruncated && (
          <div className="rp-banner-soft">文件较大，预览已截断（仅展示开头部分）</div>
        )}
        {!loading && !error && previewPath && markdown && !mdSource && (
          <div className="rp-file-content rp-file-content-md">
            <MarkdownBody content={content} />
          </div>
        )}
        {!loading && !error && previewPath && (!markdown || mdSource) && (
          <pre className="rp-file-content">{content}</pre>
        )}
        {!previewPath && !loading && (
          <div className="rp-empty">从上方树中选择文件，或从工具详情联动路径</div>
        )}
      </div>
      {menu && (
        <div
          ref={menuRef}
          className="rp-context-menu"
          style={{ left: menu.x, top: menu.y }}
          role="menu"
        >
          <button
            type="button"
            className="rp-context-menu-item"
            role="menuitem"
            onClick={() => void runMenu("add")}
          >
            加入对话
          </button>
          <div className="rp-context-menu-sep" />
          <button
            type="button"
            className="rp-context-menu-item"
            role="menuitem"
            onClick={() => void runMenu("reveal")}
          >
            在资源管理器中显示
          </button>
          <div className="rp-context-menu-sep" />
          <button
            type="button"
            className="rp-context-menu-item"
            role="menuitem"
            onClick={() => void runMenu("copyAbs")}
          >
            复制路径
          </button>
          <button
            type="button"
            className="rp-context-menu-item"
            role="menuitem"
            onClick={() => void runMenu("copyRel")}
          >
            复制相对路径
          </button>
        </div>
      )}
    </div>
  );
}
