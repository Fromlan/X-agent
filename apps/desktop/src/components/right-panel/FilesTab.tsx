import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  RefreshCw,
} from "lucide-react";
import { setPreviewPath } from "../../stores/right-panel-store";

type DirEntry = { name: string; isDir: boolean };

interface TreeNodeProps {
  cwdReady: boolean;
  relDir: string;
  depth: number;
  selectedPath: string | null;
  onSelectFile: (relPath: string) => void;
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
}: TreeNodeProps) {
  const [open, setOpen] = useState(depth === 0);
  const [entries, setEntries] = useState<DirEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!cwdReady) return;
    setLoading(true);
    setError(null);
    const res = await window.xAgent.listProjectDir(relDir);
    setLoading(false);
    if (!res.ok) {
      setError(res.error ?? "列出目录失败");
      setEntries([]);
      return;
    }
    setEntries(res.entries ?? []);
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
          className="rp-tree-row is-dir"
          onClick={() => setOpen((v) => !v)}
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
              void load();
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
                />
              );
            }
            return (
              <button
                key={childPath}
                type="button"
                className={`rp-tree-row${selectedPath === childPath ? " active" : ""}`}
                onClick={() => onSelectFile(childPath)}
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
  slotId: string;
  cwd: string | null;
  previewPath: string | null;
}

export function FilesTab({ slotId, cwd, previewPath }: Props) {
  const [content, setContent] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!cwd || !previewPath) {
      setContent("");
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    void window.xAgent.readProjectFile(previewPath).then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (!res.ok) {
        setContent("");
        setError(res.error ?? "读取失败");
        return;
      }
      setContent(res.content ?? "");
      setError(null);
    });
    return () => {
      cancelled = true;
    };
  }, [cwd, previewPath]);

  if (!cwd) {
    return <div className="rp-empty">请先打开项目文件夹</div>;
  }

  return (
    <div className="rp-files">
      <div className="rp-files-tree">
        <TreeNode
          cwdReady={Boolean(cwd)}
          relDir=""
          depth={0}
          selectedPath={previewPath}
          onSelectFile={(path) => setPreviewPath(slotId, path)}
        />
      </div>
      <div className="rp-files-preview">
        <div className="rp-files-preview-head">
          <span className="rp-files-path" title={previewPath ?? ""}>
            {previewPath ?? "未选择文件"}
          </span>
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
        {loading && <div className="rp-empty">读取中…</div>}
        {error && <div className="rp-banner-soft">{error}</div>}
        {!loading && !error && previewPath && (
          <pre className="rp-file-content">{content}</pre>
        )}
        {!previewPath && !loading && (
          <div className="rp-empty">从上方树中选择文件，或从工具详情联动路径</div>
        )}
      </div>
    </div>
  );
}
