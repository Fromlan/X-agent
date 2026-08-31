/**
 * `x-agent-logos://` 自定义协议 (主题 E #62 PR-Y7 拆分, 2026-08-31).
 *
 * - `protocol.registerSchemesAsPrivileged`: app.whenReady 之前必须
 * - `protocol.handle(LOGO_PROTOCOL, ...)`: app.whenReady 之后; 解析
 *   `custom/<uuid>` 形态, 任何其它路径返回 404
 */
import { app, net, protocol } from "electron";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { LOGO_PROTOCOL, customFilePath } from "./agent/agent-logos";

/**
 * 注册 `x-agent-logos://` 自定义协议, 让 renderer 可以请求
 * `~/.pi/agent/x-agent-logos/<uuid>.png` 而不走 `file://` (CSP 友好).
 * 必须在 app.whenReady 之前声明 privileges, handle() 必须在 ready 之后.
 */
export function registerLogoProtocolPrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: LOGO_PROTOCOL,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        bypassCSP: false,
        stream: true,
      },
    },
  ]);
}

/**
 * 注册 `x-agent-logos://` handler: 把 `custom/<uuid>` 映射到本地 PNG.
 * 仅解析 `custom/<uuid>` 形态; 任何其它路径返回 404.
 */
export function registerLogoProtocolHandler(): void {
  protocol.handle(LOGO_PROTOCOL, async (request) => {
    try {
      const url = new URL(request.url);
      // host 期望为 `custom`; pathname 形如 `/<uuid>`
      if (url.host !== "custom") {
        return new Response("not found", { status: 404 });
      }
      const uuid = url.pathname.replace(/^\/+/, "");
      const file = customFilePath(`custom:${uuid}`);
      if (!file || !existsSync(file)) {
        return new Response("not found", { status: 404 });
      }
      // net.fetch 支持 file:// 与 path, 传给 net.fetch 让 Electron 处理缓存/Range.
      return net.fetch(pathToFileURL(file).href);
    } catch {
      return new Response("bad request", { status: 400 });
    }
  });
}
