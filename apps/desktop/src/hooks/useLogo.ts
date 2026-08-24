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
  upload: () => Promise<LogoUploadResult>;
  clear: (customId: string) => Promise<LogoClearResult>;
  setActive: (id: string) => Promise<void>;
  refresh: () => Promise<LogoList | null>;
};

export function useLogo(prefs: ClientPrefs | null): UseLogoResult {
  const [list, setList] = useState<LogoList | null>(null);
  const [loading, setLoading] = useState(false);
  const lastAppliedRef = useRef<string | null>(null);

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
      // 主进程已 patch 了 prefs,这里再 pull 一次拿到最新 customs 清单。
      await refresh();
      // 把 favicon 切到新 id
      const fresh = await window.xAgent.prefs.get();
      const url = resolveLogoUrl(list, fresh.clientLogoId);
      if (url !== lastAppliedRef.current) {
        applyFaviconHref(url);
        lastAppliedRef.current = url;
      }
      void payload;
    });
    return () => {
      off();
    };
    // 我们只在 mount 时订阅 + 初次拉取,后续刷新由 onChanged 触发
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

  const upload = useCallback(async () => {
    const result = await window.xAgent.logo.uploadCustom();
    if (result.ok) {
      // 拉新清单,然后把新 logo 激活（prefs.set 会触发 logo:changed 推送,UI 自动刷新）
      await window.xAgent.prefs.set({ clientLogoId: result.logo.id });
    }
    return result;
  }, []);

  const clear = useCallback(
    async (customId: string) => {
      const result = await window.xAgent.logo.clearCustom(customId);
      if (result.ok) {
        // main 已经在 clearCustom 内部 revert 了 active（如果需要）
        await refresh();
      }
      return result;
    },
    [refresh],
  );

  const setActive = useCallback(async (id: string) => {
    await window.xAgent.prefs.set({ clientLogoId: id });
  }, []);

  return { list, loading, upload, clear, setActive, refresh };
}
