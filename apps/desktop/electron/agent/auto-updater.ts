/**
 * Packaged-app auto-update via electron-updater (GitHub Releases).
 */
import { join } from "node:path";
import { app, type BrowserWindow } from "electron";
import electronUpdater from "electron-updater";
import type { AppUpdateStatus } from "../../shared/ipc";
import { IPC_EVENTS } from "../../shared/ipc-channels";
import {
  feedMessage,
  githubReleasesUrl,
  resolveGithubFeed as resolveGithubFeedFromPaths,
  type GithubFeed,
} from "./update-feed";

export { feedMessage, githubReleasesUrl } from "./update-feed";

/** Delay before first silent check after packaged app ready. */
const STARTUP_CHECK_DELAY_MS = 8_000;

const { autoUpdater } = electronUpdater;

const DEV_STATUS: AppUpdateStatus = {
  supported: false,
  checking: false,
  available: false,
  downloading: false,
  downloaded: false,
  releasesUrl: githubReleasesUrl(),
};

/** Prefer package.json repository / publish; fall back to known release repo. */
export function resolveGithubFeed(packageJsonPath?: string): GithubFeed {
  const candidates = [
    packageJsonPath,
    join(app.getAppPath(), "package.json"),
    join(__dirname, "..", "..", "package.json"),
  ].filter((p): p is string => Boolean(p));
  return resolveGithubFeedFromPaths(candidates);
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

  /** Configure GitHub Releases feed. No-op in unpackaged/dev. */
  applyFeed(): void {
    if (!app.isPackaged) {
      this.status = { ...DEV_STATUS };
      this.emit();
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
      releasesUrl: githubReleasesUrl(feed),
      message: feedMessage(feed),
      error: undefined,
    });
  }

  /** Call once after app is ready. No-op in unpackaged/dev builds. */
  init(): void {
    if (!app.isPackaged) {
      this.status = {
        ...DEV_STATUS,
        releasesUrl: githubReleasesUrl(resolveGithubFeed()),
        message: "开发版不支持自动更新；可打开 GitHub Releases 手动下载。",
      };
      this.emit();
      return;
    }

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    this.wireEvents();
    this.applyFeed();
    this.scheduleStartupCheck();
  }

  /** Silent check a few seconds after launch (packaged only). */
  scheduleStartupCheck(): void {
    if (!app.isPackaged) return;
    setTimeout(() => {
      void this.check({ silent: true });
    }, STARTUP_CHECK_DELAY_MS);
  }

  releasesPageUrl(): string {
    return githubReleasesUrl(resolveGithubFeed());
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

  async check(options?: { silent?: boolean }): Promise<AppUpdateStatus> {
    if (!app.isPackaged) {
      this.status = {
        ...DEV_STATUS,
        releasesUrl: githubReleasesUrl(resolveGithubFeed()),
        message: "开发版不支持自动更新；可打开 GitHub Releases 手动下载。",
      };
      this.emit();
      return this.getStatus();
    }
    const silent = options?.silent === true;
    try {
      this.applyFeed();
      this.setStatus({
        checking: true,
        error: undefined,
        // Keep prior available/downloaded on silent re-check so TopBar badge stays.
        ...(silent
          ? {}
          : { available: false, downloaded: false, downloading: false }),
        message: silent ? this.status.message : "正在检查更新…",
      });
      await autoUpdater.checkForUpdates();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.setStatus({
        checking: false,
        error: message,
        message: silent
          ? `自动检查失败（可打开 Releases 手动下载）：${message}`
          : `检查更新失败：${message}`,
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
      this.applyFeed();
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
      return { ok: false, error: "当前环境不支持安装更新" };
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
