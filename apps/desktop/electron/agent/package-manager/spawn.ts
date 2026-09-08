/**
 * package-manager / spawn —— pi CLI 进程 spawn 包装
 * (issue #68 主题 J C-106, 2026-08-31 收口).
 *
 * 唯一职责: spawn `pi install` / `pi uninstall` 子进程, 收集 stdout/stderr,
 * 5 分钟超时. 不碰 catalog / settings-io / godot-pi 包装.
 *
 * 与 package-manager 顶层 installPackage / uninstallPackage 解耦: spawn
 * 只负责 "跑一次 CLI + 拿 exit code + 拿 output", 不关心 registry / settings.
 */
import { spawn } from "node:child_process";
import { spawnCli } from "../pi-cli";

/**
 * Spawn a pi subcommand, capture combined stdout/stderr, time out after
 * 5 minutes. Returns `{code, output}` — code is null on timeout.
 *
 * Force `npm_config_ignore_scripts=true` so that npm:/git sources whose
 * package.json has lifecycle scripts (`postinstall` etc.) don't run side
 * effects during x-agent's automated install. pi install has no flag for
 * this; setting the npm env var is the canonical way.
 */
export function runPiPackageCommand(
  piPath: string,
  args: string[],
  timeoutLabel: string,
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolvePromise) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawnCli(piPath, args, {
        env: {
          ...process.env,
          npm_config_ignore_scripts: "true",
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      resolvePromise({ code: 1, output: message });
      return;
    }
    let output = "";
    const append = (chunk: Buffer | string) => {
      output += chunk.toString();
      if (output.length > 40_000) output = output.slice(-30_000);
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        // ignore
      }
      // unref 避免子进程阻塞 Node 事件循环；同时等待 'exit' 防止残留。
      try {
        child.unref();
      } catch {
        // ignore
      }
      // 不阻塞主流程，但触发一次等待以让日志完整。
      void Promise.race([
        new Promise<void>((res) => child.once("exit", () => res())),
        new Promise<void>((res) => setTimeout(res, 1500)),
      ]).finally(() => {
        resolvePromise({
          code: null,
          output: `${output}\n${timeoutLabel} timeout`,
        });
      });
    }, 5 * 60 * 1000);
    child.on("error", (err) => {
      if (timedOut) return;
      clearTimeout(timer);
      resolvePromise({ code: 1, output: `${output}\n${err.message}` });
    });
    child.on("close", (code) => {
      if (timedOut) return;
      clearTimeout(timer);
      resolvePromise({ code, output });
    });
  });
}
