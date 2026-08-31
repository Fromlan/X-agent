/**
 * 窗口外部 URL 导航守卫 (主题 E #62 PR-Y7 拆分, 2026-08-31).
 *
 * 拦截 `setWindowOpenHandler` (window.open) 和 `will-navigate` (location 跳转),
 * 走 `validateExternalHttpUrl` 校验后用 `shell.openExternal` 打开.
 * E4: origin 精确匹配, 防 `127.0.0.1:5173.evil.com` 前缀伪匹配.
 */
import { BrowserWindow, shell } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { validateExternalHttpUrl } from "./agent/external-url";

/**
 * 走 shell.openExternal 打开 http(s) URL; validateExternalHttpUrl 拒绝非 http(s) 与
 * 私网 / link-local IP 避免被攻陷的 renderer 引向 169.254.x.x metadata endpoint.
 */
export async function openExternalHttpUrl(
  url: string,
): Promise<{ ok: boolean; error?: string }> {
  const checked = validateExternalHttpUrl(url);
  if (!checked.ok) return checked;
  try {
    await shell.openExternal(checked.href);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "无效链接",
    };
  }
}

/** 拦截 setWindowOpenHandler (window.open 走这里). */
export function installWindowOpenHandler(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalHttpUrl(url);
    return { action: "deny" };
  });
}

/** 拦截 will-navigate (location 跳转走这里, e.g. <a href target=_self>). */
export function installWillNavigateHandler(
  win: BrowserWindow,
  rendererUrl: string | undefined,
): void {
  win.webContents.on("will-navigate", (event, url) => {
    if (url === win.webContents.getURL()) return;
    // E4: origin 精确匹配 (防 `127.0.0.1:5173.evil.com` 前缀伪匹配).
    if (rendererUrl && new URL(url).origin === new URL(rendererUrl).origin) {
      return;
    }
    if (url.startsWith("file:")) {
      // Packaged app: only allow navigation within our renderer directory.
      try {
        const rendererRoot = pathToFileURL(
          join(__dirname, "../renderer") + "/",
        ).href;
        if (url.startsWith(rendererRoot)) return;
      } catch {
        // fall through to deny
      }
      event.preventDefault();
      return;
    }
    event.preventDefault();
    void openExternalHttpUrl(url);
  });
}
