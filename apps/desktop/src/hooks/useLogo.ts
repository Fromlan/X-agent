/**
 * `useLogo` — 单一入口：拉取 logo 清单、监听主进程推送、给 favicon 打补丁。
 *
 * 主进程把 favicon 视为只读资源；切 logo 不会自动重注 `<link rel="icon">`。
 * 本 hook 在挂载 / 收到 `logo:changed` 推送时把 link 元素重新指向当前 id
 * 对应的资源 URL。
 *
 * splash 屏（public/splash.html）依旧展示 default logo —— 它在 runtime 就绪
 * 前就被销毁，无法跟设置同步。这一点在 GeneralSettingsPage 的提示里说清。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientPrefs, LogoList, LogoUploadResult, LogoClearResult } from "@shared/ipc";

/** 单一真源：把 clientLogoId 映射到 favicon 用的 URL。 */
export function resolveLogoUrl(
  list: LogoList | null,
  logoId: string,
): string {
  if (!list) return "./favicon.png";
  if (logoId === "default") return "./favicon.png";
  if (logoId.startsWith("preset:")) {
    const found = list.presets.find((p) => p.id === logoId);
    return found ? found.url : "./favicon.png";
  }
  if (logoId.startsWith("custom:")) {
    const found = list.customs.find((c) => c.id === logoId);
    return found ? found.url : "./favicon.png";
  }
  return "./favicon.png";
}

/** 在 <head> 里找一个 <link rel="icon"> 并改写其 href；没有就建一个。 */
function applyFaviconHref(href: string): void {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    link.type = "image/png";
    document.head.appendChild(link);
  }
  // 加一个 cache-busting query,避免某些环境对同 origin 的同一 href 不刷新。
  const stamp = Date.now();
  link.href = href.includes("?") ? `${href}&_=${stamp}` : `${href}?_=${stamp}`;
}

export type UseLogoResult = {
  list: LogoList | null;
  loading: boolean;
  /**
   * The id currently in effect. Owned by useLogo so the picker highlight
   * and the bottom "当前：…" label stay in sync with the IPC call,
   * even if App.tsx's `prefs` state hasn't propagated yet.
   * Falls back to `prefs?.clientLogoId ?? "default"` while the first
   * IPC response is in flight.
   */
  activeId: string;
  upload: () => Promise<LogoUploadResult>;
  clear: (customId: string) => Promise<LogoClearResult>;
  setActive: (id: string) => Promise<void>;
  refresh: () => Promise<LogoList | null>;
};

export function useLogo(prefs: ClientPrefs | null): UseLogoResult {
  const [list, setList] = useState<LogoList | null>(null);
  const [loading, setLoading] = useState(false);
  // 单一权威：先取 prefs,空时回退 default。setActive 后立即覆盖,不等
  // App.tsx 那边 React state 慢慢追过来(IPC 走的是 Promise,不会反向
  // 自动 setState)。
  const [activeId, setActiveId] = useState<string>(
    prefs?.clientLogoId ?? "default",
  );
  const lastAppliedRef = useRef<string | null>(null);

  // prefs 改变(主题/外观模式/其他)时,把 activeId 跟 prefs 重新对齐;
  // 切 logo 走 setActive 不经过这里。
  useEffect(() => {
    if (prefs) setActiveId(prefs.clientLogoId);
  }, [prefs?.clientLogoId]);

  const refresh = useCallback(async (): Promise<LogoList | null> => {
    setLoading(true);
    try {
      const next = await window.xAgent.logo.listPresets();
      setList(next);
      return next;
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch + 监听主进程推送
  useEffect(() => {
    void refresh();
    const off = window.xAgent.logo.onChanged(async (payload: { id: string }) => {
      await refresh();
      // 主进程在 setPrefs handler 里已经把新 clientLogoId 写盘,
      // 这里直接 pull 一次,保持 activeId 与磁盘一致。
      try {
        const fresh = await window.xAgent.prefs.get();
        setActiveId(fresh.clientLogoId);
        const url = resolveLogoUrl(list, fresh.clientLogoId);
        if (url !== lastAppliedRef.current) {
          applyFaviconHref(url);
          lastAppliedRef.current = url;
        }
      } catch {
        /* ignore */
      }
      void payload;
    });
    return () => {
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 当 prefs.clientLogoId 或 list 变化时,把 favicon 应用一次。
  useEffect(() => {
    if (!prefs || !list) return;
    const url = resolveLogoUrl(list, prefs.clientLogoId);
    if (url !== lastAppliedRef.current) {
      applyFaviconHref(url);
      lastAppliedRef.current = url;
    }
  }, [prefs, list]);

  const upload = useCallback(async (): Promise<LogoUploadResult> => {
    const result = await window.xAgent.logo.uploadCustom();
    if (result.ok) {
      // 立即把 activeId 切到新 logo,不依赖 App.tsx 那边 React state 追过来
      setActiveId(result.logo.id);
      await window.xAgent.prefs.set({ clientLogoId: result.logo.id });
    }
    return result;
  }, []);

  const clear = useCallback(
    async (customId: string): Promise<LogoClearResult> => {
      const result = await window.xAgent.logo.clearCustom(customId);
      if (result.ok) {
        // main 端如果 revert 了 active,这里拉一次 prefs 对齐本地 activeId
        await refresh();
        try {
          const fresh = await window.xAgent.prefs.get();
          setActiveId(fresh.clientLogoId);
        } catch {
          /* ignore */
        }
      }
      return result;
    },
    [refresh],
  );

  const setActive = useCallback(async (id: string) => {
    // 立即 setActiveId 让 UI 立刻高亮,不等 IPC roundtrip;若 IPC 失败再
    // 通过 onChanged / 下一次 refresh 兜底对齐。
    setActiveId(id);
    try {
      await window.xAgent.prefs.set({ clientLogoId: id });
    } catch {
      /* 上层已显示错误,favicon 也不会变;无副作用 */
    }
  }, []);

  return { list, loading, activeId, upload, clear, setActive, refresh };
}
