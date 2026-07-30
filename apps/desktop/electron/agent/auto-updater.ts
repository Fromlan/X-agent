/**
 * Packaged-app auto-update via electron-updater.
 * GitHub Releases (provider) or Gitee mirror (generic latest Release).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { app, type BrowserWindow } from "electron";
import electronUpdater from "electron-updater";
import type {
  AppUpdateStatus,
  UpdateSource,
} from "../../shared/ipc";
import { normalizeUpdateSource } from "../../shared/ipc";
import { IPC_EVENTS } from "../../shared/ipc-channels";
import { loadPrefs } from "./prefs";
import {
  DEFAULT_GITHUB_OWNER,
  DEFAULT_GITHUB_REPO,
  feedMessage,
  giteeGenericFeedUrl,
  type GithubFeed,
  parseGithubRepoUrl,
} from "./update-feed";

export {
  feedMessage,
  GITEE_LATEST_TAG,
  GITEE_OWNER,
  GITEE_REPO,
  giteeGenericFeedUrl,
} from "./update-feed";

const { autoUpdater } = electronUpdater;

const DEV_STATUS: AppUpdateStatus = {
  supported: false,
  checking: false,
  available: false,
  downloading: false,
  downloaded: false,
  message: "自动更新仅在打包后的安装版中可用（开发模式请使用 npm run dist）。",
};

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

  return { owner: DEFAULT_GITHUB_OWNER, repo: DEFAULT_GITHUB_REPO };
}

export class AppAutoUpdater {
  private status: AppUpdateStatus = { ...DEV_STATUS };
  private getWindow: () => BrowserWindow | null;
  private wired = false;
  private activeSource: UpdateSource = "github";

  constructor(getWindow: () => BrowserWindow | null) {
    this.getWindow = getWindow;
  }

  getStatus(): AppUpdateStatus {
    return { ...this.status };
  }

  /** Apply feed for the given source (or current prefs). No-op in unpackaged/dev. */
  applyFeed(source?: UpdateSource): void {
    if (!app.isPackaged) {
      this.status = { ...DEV_STATUS };
      this.emit();
      return;
    }

    const next = normalizeUpdateSource(
      source ?? loadPrefs().updateSource,
    );
    this.activeSource = next;

    if (next === "gitee") {
      autoUpdater.setFeedURL({
        provider: "generic",
        url: giteeGenericFeedUrl(),
      });
      this.setStatus({
        supported: true,
        source: next,
        message: feedMessage("gitee"),
        error: undefined,
      });
      return;
    }

    const feed = resolveGithubFeed();
    autoUpdater.setFeedURL({
      provider: "github",
      owner: feed.owner,
      repo: feed.repo,
    });
    this.setStatus({
      supported: true,
      source: next,
      message: feedMessage("github", feed),
      error: undefined,
    });
  }

  /** Call once after app is ready. No-op in unpackaged/dev builds. */
  init(): void {
    if (!app.isPackaged) {
      this.status = { ...DEV_STATUS };
      this.emit();
      return;
    }

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    this.wireEvents();
    this.applyFeed();
  }

  private setStatus(patch: Partial<AppUpdateStatus>): void {
    this.status = { ...this.status, ...patch };
    this.emit();
  }

  private emit(): void {
    const win = this.getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC_EVENTS.updateStatus, this.getStatus());
    }
  }

  private wireEvents(): void {
    if (this.wired) return;
    this.wired = true;

    autoUpdater.on("checking-for-update", () => {
      this.setStatus({
        checking: true,
        error: undefined,
        source: this.activeSource,
        message: "正在检查更新…",
      });
    });

    autoUpdater.on("update-available", (info) => {
      this.setStatus({
        checking: false,
        available: true,
        version: info.version,
        source: this.activeSource,
        message: `发现新版本 ${info.version}`,
      });
    });

    autoUpdater.on("update-not-available", (info) => {
      this.setStatus({
        checking: false,
        available: false,
        version: info.version,
        source: this.activeSource,
        message: `已是最新版本（${info.version}）`,
      });
    });

    autoUpdater.on("download-progress", (progress) => {
      this.setStatus({
        downloading: true,
        progress: Math.round(progress.percent),
        source: this.activeSource,
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
        source: this.activeSource,
        message: `已下载 ${info.version}，可重启安装`,
      });
    });

    autoUpdater.on("error", (err) => {
      this.setStatus({
        checking: false,
        downloading: false,
        error: err.message,
        source: this.activeSource,
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
      this.applyFeed();
      this.setStatus({
        checking: true,
        error: undefined,
        available: false,
        downloaded: false,
        downloading: false,
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
      this.applyFeed(this.activeSource);
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
