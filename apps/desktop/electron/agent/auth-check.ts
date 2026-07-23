import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AuthStatus } from "../../shared/ipc";
import { getAgentDirPath } from "./prefs";

/** Lightweight check that Pi auth.json exists and has at least one credential entry. */
export function checkAuth(): AuthStatus {
  const authPath = join(getAgentDirPath(), "auth.json");
  if (!existsSync(authPath)) {
    return {
      ok: false,
      authPath,
      message:
        "未找到 Pi 认证文件。请在设置 → 供应商中配置 API Key，或使用 Pi CLI 执行 /login。",
    };
  }
  try {
    const raw = JSON.parse(readFileSync(authPath, "utf8")) as unknown;
    const hasKeys =
      raw &&
      typeof raw === "object" &&
      Object.keys(raw as Record<string, unknown>).length > 0;
    if (!hasKeys) {
      return {
        ok: false,
        authPath,
        message:
          "auth.json 为空。请在设置 → 供应商中配置 API Key，或使用 Pi CLI 登录。",
      };
    }
    return {
      ok: true,
      authPath,
      message: "已检测到 Pi 认证",
    };
  } catch {
    return {
      ok: false,
      authPath,
      message: "auth.json 无法解析，请检查文件格式。",
    };
  }
}
