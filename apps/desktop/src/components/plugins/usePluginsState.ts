/**
 * PluginsPage 业务状态与副作用:列表刷新、选中、编辑器开关、skills 启用、packages。
 * 抽出为 hook 让 PluginsPage 顶层壳只负责渲染。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ClientPrefs,
  InstalledPackageInfo,
  PluginItem,
  PluginKind,
  PluginScope,
} from "@shared/ipc";
import { useConfirm } from "@/lib/app-confirm";
import { kindLabel, type PageKind, type ScopeFilter } from "./types";

export function usePluginsState(opts: {
  cwd: string | null;
  prefs: ClientPrefs;
  hasActiveSession?: boolean;
  onPrefsChanged?: (prefs: ClientPrefs) => void;
}) {
  const { cwd, prefs, hasActiveSession = false, onPrefsChanged } = opts;
  const confirm = useConfirm();
  const [kind, setKind] = useState<PageKind>("prompt");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [items, setItems] = useState<PluginItem[]>([]);
  const [packages, setPackages] = useState<InstalledPackageInfo[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [baseline, setBaseline] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createScope, setCreateScope] = useState<PluginScope>("global");
  const [packageSource, setPackageSource] = useState("");

  const isPackageTab = kind === "package";
  const isSkillTab = kind === "skill";
  const dirty = content !== baseline;

  const filtered = useMemo(() => {
    if (isPackageTab) return [];
    return items.filter((item) => {
      if (item.kind !== kind) return false;
      if (scopeFilter === "all") return true;
      return item.scope === scopeFilter;
    });
  }, [items, kind, scopeFilter, isPackageTab]);

  const selected = useMemo(
    () => items.find((i) => i.path === selectedPath) ?? null,
    [items, selectedPath],
  );

  const refresh = useCallback(async () => {
    const [list, pkgs] = await Promise.all([
      window.xAgent.listPlugins(cwd),
      window.xAgent.listInstalledPackages(),
    ]);
    setItems(list);
    setPackages(pkgs);
  }, [cwd]);

  const openItem = useCallback(async (item: PluginItem) => {
    setSelectedPath(item.path);
    setError(null);
    setMessage(null);
    const result = await window.xAgent.readPlugin(item.path);
    if (!result.ok) {
      setError(result.error ?? "读取失败");
      setContent("");
      setBaseline("");
      setWarnings([]);
      return;
    }
    setContent(result.content ?? "");
    setBaseline(result.content ?? "");
    setWarnings(result.warnings ?? []);
  }, []);

  const confirmSkillIndexChange = useCallback(async (): Promise<boolean> => {
    if (!hasActiveSession) return true;
    return confirm({
      title: "更改技能开关",
      message: "会重建本会话的技能索引。确定继续？",
      confirmLabel: "继续",
      tone: "warn",
    });
  }, [confirm, hasActiveSession]);

  const setSkillsEnabled = useCallback(
    async (skillIds: string[], enabled: boolean) => {
      const ids = skillIds
        .map((id) => id.trim())
        .filter((id) => id.length > 0);
      if (ids.length === 0) return;
      if (!(await confirmSkillIndexChange())) return;
      const idSet = new Set(ids.map((id) => id.toLowerCase()));
      const currentDisabled = prefs.disabledSkills ?? [];
      const without = currentDisabled.filter(
        (d) => !idSet.has(d.trim().toLowerCase()),
      );
      const nextDisabled = enabled
        ? without
        : [
            ...without,
            ...ids.filter(
              (id) =>
                !without.some((d) => d.trim().toLowerCase() === id.toLowerCase()),
            ),
          ];
      setBusy(true);
      setError(null);
      try {
        const next = await window.xAgent.setPrefs({
          disabledSkills: nextDisabled,
        });
        onPrefsChanged?.(next);
        setMessage(enabled ? "已启用技能" : "已关闭技能");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [confirmSkillIndexChange, onPrefsChanged, prefs.disabledSkills],
  );

  const toggleSkill = useCallback(
    async (skillId: string, enabled: boolean) => {
      await setSkillsEnabled([skillId], enabled);
    },
    [setSkillsEnabled],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (isPackageTab) {
      setSelectedPath(null);
      setContent("");
      setBaseline("");
      setWarnings([]);
      return;
    }
    const first = filtered[0];
    if (!first) {
      setSelectedPath(null);
      setContent("");
      setBaseline("");
      setWarnings([]);
      return;
    }
    if (!selectedPath || !filtered.some((i) => i.path === selectedPath)) {
      void openItem(first);
    }
  }, [filtered, openItem, selectedPath, isPackageTab]);

  const save = useCallback(async () => {
    if (!selectedPath) return;
    setBusy(true);
    setError(null);
    const result = await window.xAgent.writePlugin(selectedPath, content);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "保存失败");
      return;
    }
    setBaseline(content);
    setWarnings(result.warnings ?? []);
    setMessage("已保存");
    await refresh();
    await window.xAgent.session.reloadResources();
  }, [content, refresh, selectedPath]);

  const create = useCallback(async () => {
    if (isPackageTab) return;
    setBusy(true);
    setError(null);
    const result = await window.xAgent.createPlugin({
      kind: kind as PluginKind,
      scope: createScope,
      name: createName.trim(),
      cwd,
    });
    setBusy(false);
    if (!result.ok || !result.item) {
      setError(result.error ?? "创建失败");
      return;
    }
    setCreateOpen(false);
    setCreateName("");
    setMessage(`已创建 ${result.item.name}`);
    await refresh();
    await openItem(result.item);
    await window.xAgent.session.reloadResources();
  }, [createName, createScope, cwd, isPackageTab, kind, openItem, refresh]);

  const remove = useCallback(async () => {
    if (!selected) return;
    const ok = await confirm({
      title: "删除插件",
      message: `删除 ${selected.name}？此操作不可撤销。`,
      confirmLabel: "删除",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    const result = await window.xAgent.deletePlugin(selected.path);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "删除失败");
      return;
    }
    setMessage("已删除");
    setSelectedPath(null);
    await refresh();
    await window.xAgent.session.reloadResources();
  }, [confirm, refresh, selected]);

  const installPkg = useCallback(
    async (source: string) => {
      setBusy(true);
      setError(null);
      const result = await window.xAgent.installPackage(source);
      setBusy(false);
      if (!result.ok) {
        setError(
          [result.error, result.output].filter(Boolean).join("\n") ||
            "安装失败",
        );
        return;
      }
      setKind("package");
      const counts = result.package
        ? [
            result.package.skillCount != null
              ? `${result.package.skillCount} 技能`
              : null,
            result.package.promptCount != null
              ? `${result.package.promptCount} 提示词`
              : null,
            result.package.extensionCount != null
              ? `${result.package.extensionCount} 扩展`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")
        : "";
      setMessage(
        `已安装 ${result.package?.name ?? source}${counts ? `（${counts}，可在对应页签查看）` : ""}`,
      );
      setPackageSource("");
      await refresh();
      await window.xAgent.session.reloadResources();
    },
    [refresh],
  );

  const installGodotPi = useCallback(async () => {
    setBusy(true);
    setError(null);
    const result = await window.xAgent.installGodotPiPackage();
    setBusy(false);
    if (!result.ok) {
      setError(
        [result.error, result.output].filter(Boolean).join("\n") || "安装失败",
      );
      return;
    }
    setKind("package");
    const counts = result.package
      ? [
          result.package.skillCount != null
            ? `${result.package.skillCount} 技能`
            : null,
          result.package.promptCount != null
            ? `${result.package.promptCount} 提示词`
            : null,
          result.package.extensionCount != null
            ? `${result.package.extensionCount} 扩展`
            : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : "";
    setMessage(
      `已安装 X-agent 原生技能包：${result.package?.name ?? ""}${counts ? `（${counts}，可在「技能 / 提示词 / 扩展」页签查看）` : ""}`,
    );
    await refresh();
    await window.xAgent.session.reloadResources();
  }, [refresh]);

  const uninstallPkg = useCallback(
    async (source: string, name: string) => {
      const ok = await confirm({
        title: "卸载 Packages",
        message: `卸载 ${name}？将执行 pi uninstall 并从设置中移除该包。`,
        confirmLabel: "卸载",
        tone: "danger",
      });
      if (!ok) return;
      setBusy(true);
      const res = await window.xAgent.uninstallPackage(source);
      setBusy(false);
      if (!res.ok) setError(res.error ?? "卸载失败");
      else {
        setMessage("已卸载");
        setError(null);
        await refresh();
      }
    },
    [confirm, refresh],
  );

  const dismissNotice = useCallback(() => {
    setMessage(null);
    setError(null);
  }, []);

  return {
    // state
    kind,
    setKind: (k: PageKind) => {
      setKind(k);
      setMessage(null);
      setError(null);
    },
    scopeFilter,
    setScopeFilter,
    items,
    packages,
    selectedPath,
    selected,
    content,
    setContent,
    baseline,
    dirty,
    warnings,
    message,
    error,
    busy,
    createOpen,
    setCreateOpen,
    createName,
    setCreateName,
    createScope,
    setCreateScope,
    packageSource,
    setPackageSource,
    filtered,
    isPackageTab,
    isSkillTab,
    prefs,
    currentKindLabel: kindLabel(kind as PluginKind),
    // actions
    refresh,
    openItem,
    save,
    create,
    remove,
    installPkg,
    installGodotPi,
    uninstallPkg,
    setSkillsEnabled,
    toggleSkill,
    dismissNotice,
  };
}

export type PluginsState = ReturnType<typeof usePluginsState>;