import { join } from "node:path";
import { AuthStatus } from "../../shared/ipc";
import { getAgentDirPath } from "./prefs";
import {
  fileExistsAsync,
  readJsonAsync,
} from "./lib/atomic-write";

/**
 * 启动期一次性缓存 auth.json 状态(填充 on first call, 由 `app-runtime.ts` 启动
 * 时在 `checkBash` / `checkAuth` 调用前隐式预热)。后续 IPC `checkAuth` 直接
 * 读 cache,避免每次 IPC 触发同步 I/O。
 *
 * **失效时机**:任何直接写 `auth.json` 的路径在写盘后必须调用
 * {@link invalidateAuthCache},否则 `checkAuth` 会返回陈旧的 `ok=false`,
 * 让 ReadyChecklist 误以为"未配置供应商"。
 * 当前调用点见 `provider-pi-sync.ts` 中的 `syncProfileToPi` /
 * `pruneProviderIdFromPi`。
 */
let cachedAuth: AuthStatus | null = null;

/** Lightweight check that Pi auth.json exists and has at least one credential entry. */
export async function checkAuth(): Promise<AuthStatus> {
  if (cachedAuth) return cachedAuth;
  const authPath = join(getAgentDirPath(), "auth.json");
  if (!(await fileExistsAsync(authPath))) {
    cachedAuth = {
      ok: false,
      authPath,
      message:
        "未找到 Pi 认证。可点「打开 Pi 登录」用 CLI /login，或在设置 → 供应商中配置 API Key。",
    };
    return cachedAuth;
  }
  try {
    const raw = await readJsonAsync<unknown>(authPath, null);
    const hasKeys =
      raw &&
      typeof raw === "object" &&
      Object.keys(raw as Record<string, unknown>).length > 0;
    cachedAuth = hasKeys
      ? {
          ok: true,
          authPath,
          message: "已检测到 Pi 认证",
        }
      : {
          ok: false,
          authPath,
          message:
            "auth.json 为空。可点「打开 Pi 登录」用 CLI /login，或在设置 → 供应商中配置 API Key。",
        };
    return cachedAuth;
  } catch {
    cachedAuth = {
      ok: false,
      authPath,
      message: "auth.json 无法解析，请检查文件格式。",
    };
    return cachedAuth;
  }
}

/**
 * 让下一次 {@link checkAuth} 重新读 `auth.json`。
 *
 * 任何成功改写 `auth.json` 的路径(例如 `syncProfileToPi` /
 * `pruneProviderIdFromPi`)都必须在写盘后调用此函数,否则 UI 上的
 * 「配置供应商」引导会停留在「auth 未配置」状态。
 */
export function invalidateAuthCache(): void {
  cachedAuth = null;
}
