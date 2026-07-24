/**
 * Packaged-app auto-update via electron-updater + GitHub Releases.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { app, type BrowserWindow } from "electron";
import electronUpdater from "electron-updater";
import type { AppUpdateStatus } from "../../shared/ipc";

const { autoUpdater } = electronUpdater;

const DEV_STATUS: AppUpdateStatus = {
  supported: false,
  checking: false,
  available: false,
  downloading: false,
  downloaded: false,
  message: "自动更新仅在打包后的安装版中可用（开发模式请使用 npm run dist）。",
};

const DEFAULT_OWNER = "Fromlan";
const DEFAULT_REPO = "X-agent";

type GithubFeed = { owner: string; repo: string };

function parseGithubRepoUrl(url: string): GithubFeed | null {
  const trimmed = url.trim().replace(/\.git$/i, "");
  const https = trimmed.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/i,
  );
  if (https) return { owner: https[1]!, repo: https[2]! };
  const ssh = trimmed.match(/^git@github\.com:([^/]+)\/([^/]+)$/i);
  if (ssh) return { owner: ssh[1]!, repo: ssh[2]! };
  return null;
}

/** Prefer package.json repository / publish; fall back to known release repo. */
export function resolveGithubFeed(
  packageJsonPath?: string,
): GithubFeed {
  const candidates = [
    packageJsonPath,
    join(app.getAppPath(), "package.json"),
    join(__dirname, "..", "..", "package.json"),
  ].filter((p): p is string => Boolean(p));

  for (const path of candidates) {
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as {
        repository?: string | { url?: string };
        build?: {
          publish?:
            | { provider?: string; owner?: string; repo?: string }
            | Array<{ provider?: string; owner?: string; repo?: string }>;
        };
      };

      const publish = raw.build?.publish;
      const publishEntry = Array.isArray(publish) ? publish[0] : publish;
      if (
        publishEntry?.provider === "github" &&
        publishEntry.owner &&
        publishEntry.repo
      ) {
        return { owner: publishEntry.owner, repo: publishEntry.repo };
      }

      const repoUrl =
        typeof raw.repository === "string"
          ? raw.repository
          : raw.repository?.url;
      if (repoUrl) {
        const parsed = parseGithubRepoUrl(repoUrl);
        if (parsed) return parsed;
      }
    } catch {
      // try next candidate
    }
  }

  return { owner: DEFAULT_OWNER, repo: DEFAULT_REPO };
}

export class AppAutoUpdater {
  private status: AppUpdateStatus = { ...DEV_STATUS };
  private getWindow: () => BrowserWindow | null;
  private wired = false;

  constructor(getWindow: () => BrowserWindow | null) {
    this.getWindow = getWindow;
  }

  getStatus(): AppUpdateStatus {
    return { ...this.status };
  }

  /** Call once after app is ready. No-op in unpackaged/dev builds. */
  init(): void {
    if (!app.isPackaged) {
      this.status = { ...DEV_STATUS };
      this.emit();
      return;
    }

    const feed = resolveGithubFeed();
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.setFeedURL({
      provider: "github",
      owner: feed.owner,
      repo: feed.repo,
    });

    this.status = {
      supported: true,
      checking: false,
      available: false,
      downloading: false,
      downloaded: false,
      message: `已配置 GitHub 更新源：${feed.owner}/${feed.repo}`,
    };
    this.wireEvents();
    this.emit();
  }

  private setStatus(patch: Partial<AppUpdateStatus>): void {
    this.status = { ...this.status, ...patch };
    this.emit();
  }

  private emit(): void {
    const win = this.getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send("update:status", this.getStatus());
    }
  }

  private wireEvents(): void {
    if (this.wired) return;
    this.wired = true;

    autoUpdater.on("checking-for-update", () => {
      this.setStatus({
        checking: true,
        error: undefined,
        message: "正在检查更新…",
      });
    });

    autoUpdater.on("update-available", (info) => {
      this.setStatus({
        checking: false,
        available: true,
        version: info.version,
        message: `发现新版本 ${info.version}`,
      });
    });

    autoUpdater.on("update-not-available", (info) => {
      this.setStatus({
        checking: false,
        available: false,
        version: info.version,
        message: `已是最新版本（${info.version}）`,
      });
    });

    autoUpdater.on("download-progress", (progress) => {
      this.setStatus({
        downloading: true,
        progress: Math.round(progress.percent),
        message: `下载中 ${Math.round(progress.percent)}%`,
      });
    });

    autoUpdater.on("update-downloaded", (info) => {
      this.setStatus({
        downloading: false,
        downloaded: true,
        available: true,
        progress: 100,
        version: info.version,
        message: `已下载 ${info.version}，可重启安装`,
      });
    });

    autoUpdater.on("error", (err) => {
      this.setStatus({
        checking: false,
        downloading: false,
        error: err.message,
        message: `更新失败：${err.message}`,
      });
    });
  }

  async check(): Promise<AppUpdateStatus> {
    if (!app.isPackaged) {
      this.status = { ...DEV_STATUS };
      this.emit();
      return this.getStatus();
    }
    try {
      this.setStatus({
        checking: true,
        error: undefined,
        message: "正在检查更新…",
      });
      await autoUpdater.checkForUpdates();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.setStatus({
        checking: false,
        error: message,
        message: `检查更新失败：${message}`,
      });
    }
    return this.getStatus();
  }

  async download(): Promise<AppUpdateStatus> {
    if (!app.isPackaged) {
      this.status = { ...DEV_STATUS };
      this.emit();
      return this.getStatus();
    }
    if (!this.status.available) {
      this.setStatus({
        message: "没有可下载的更新，请先检查更新。",
      });
      return this.getStatus();
    }
    try {
      this.setStatus({
        downloading: true,
        progress: 0,
        error: undefined,
        message: "开始下载更新…",
      });
      await autoUpdater.downloadUpdate();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.setStatus({
        downloading: false,
        error: message,
        message: `下载失败：${message}`,
      });
    }
    return this.getStatus();
  }

  quitAndInstall(): { ok: boolean; error?: string } {
    if (!app.isPackaged) {
      return { ok: false, error: DEV_STATUS.message };
    }
    if (!this.status.downloaded) {
      return { ok: false, error: "尚未下载更新，请先下载。" };
    }
    try {
      autoUpdater.quitAndInstall(false, true);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
