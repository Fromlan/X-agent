import { useEffect, useState } from "react";
import { SelectMenu } from "../SelectMenu";
import { SettingsNotice, useAutoClearNotice } from "../SettingsNotice";
import {
  THEME_IDS,
  THEME_LABELS,
  type AppUpdateStatus,
  type BashCheckResult,
  type ClientPrefs,
  type ColorMode,
  type ThemeId,
  type ThinkingLevel,
  type UpdateSource,
} from "@shared/ipc";

const THINKING_LEVELS: ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

type Props = {
  open: boolean;
  prefs: ClientPrefs;
  onPrefsChanged?: (prefs: ClientPrefs) => void;
  onBashChanged?: (bash: BashCheckResult) => void;
  onOpenProviders: () => void;
};

export function GeneralSettingsPage({
  open,
  prefs,
  onPrefsChanged,
  onBashChanged,
  onOpenProviders,
}: Props) {
  const [bash, setBash] = useState<BashCheckResult | null>(null);
  const [generalMsg, setGeneralMsg] = useState<string | null>(null);
  const [authHint, setAuthHint] = useState<string | null>(null);
  const [piLoginBusy, setPiLoginBusy] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<AppUpdateStatus | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const [bashStatus, update] = await Promise.all([
        window.xAgent.checkBash(),
        window.xAgent.getUpdateStatus(),
      ]);
      if (cancelled) return;
      setBash(bashStatus);
      setUpdateStatus(update);
    })();
    const off = window.xAgent.onUpdateStatus((status) => {
      setUpdateStatus(status);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setGeneralMsg(null);
      setAuthHint(null);
    }
  }, [open]);

  useAutoClearNotice(generalMsg, () => setGeneralMsg(null));
  useAutoClearNotice(authHint, () => setAuthHint(null));

  return (
              <section className="settings-page">
                <div className="settings-page-head">
                  <h3>通用</h3>
                  <p className="modal-hint">外观、对话、Shell、认证与更新</p>
                </div>

                <div className="settings-block">
                  <h4 className="settings-block-title">外观</h4>
                  <div className="settings-row">
                    <span className="settings-row-label">主题</span>
                    <SelectMenu
                      variant="control"
                      value={prefs.themeId}
                      options={THEME_IDS.map((id) => ({
                        value: id,
                        label: THEME_LABELS[id],
                      }))}
                      onChange={(v) => {
                        void (async () => {
                          const next = await window.xAgent.setPrefs({
                            themeId: v as ThemeId,
                          });
                          onPrefsChanged?.(next);
                        })();
                      }}
                      aria-label="主题"
                    />
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">外观模式</span>
                    <SelectMenu
                      variant="control"
                      value={prefs.colorMode}
                      options={[
                        { value: "dark", label: "深色" },
                        { value: "light", label: "浅色" },
                      ]}
                      onChange={(v) => {
                        void (async () => {
                          const next = await window.xAgent.setPrefs({
                            colorMode: v as ColorMode,
                          });
                          onPrefsChanged?.(next);
                        })();
                      }}
                      aria-label="外观模式"
                    />
                  </div>
                </div>

                <div className="settings-block">
                  <h4 className="settings-block-title">对话</h4>
                  <label className="settings-row settings-row-check">
                    <span className="settings-row-label">显示思考过程</span>
                    <input
                      type="checkbox"
                      checked={prefs.showThinking}
                      onChange={async (e) => {
                        const next = await window.xAgent.setPrefs({
                          showThinking: e.target.checked,
                        });
                        onPrefsChanged?.(next);
                      }}
                    />
                  </label>
                  <div className="settings-row">
                    <span className="settings-row-label">默认 Thinking</span>
                    <SelectMenu
                      variant="control"
                      value={prefs.thinkingLevel}
                      options={THINKING_LEVELS.map((level) => ({
                        value: level,
                        label: level,
                      }))}
                      onChange={(v) => {
                        void (async () => {
                          const level = v as ThinkingLevel;
                          const applied =
                            await window.xAgent.setThinkingLevel(level);
                          if (applied.ok) {
                            const next = await window.xAgent.getPrefs();
                            onPrefsChanged?.(next);
                            setGeneralMsg(null);
                            return;
                          }
                          const next = await window.xAgent.setPrefs({
                            thinkingLevel: level,
                          });
                          onPrefsChanged?.(next);
                          setGeneralMsg(
                            "已保存默认 Thinking；打开项目后对当前会话生效。",
                          );
                        })();
                      }}
                      aria-label="默认 Thinking 级别"
                    />
                  </div>
                </div>

                <div className="settings-block">
                  <h4 className="settings-block-title">Shell</h4>
                  <p className="modal-hint">
                    Pi 的 bash 工具需要可用的 bash（Windows 上多为 Git
                    Bash）。路径写入 ~/.pi/agent/settings.json。
                  </p>
                  <div className="settings-inline-row">
                    <input
                      type="text"
                      className="input input-mono"
                      readOnly
                      value={bash?.shellPath ?? ""}
                      placeholder="尚未配置 shellPath…"
                      aria-label="当前 shellPath"
                    />
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={async () => {
                        const status = await window.xAgent.checkBash();
                        setBash(status);
                        onBashChanged?.(status);
                        setGeneralMsg(status.message);
                      }}
                    >
                      检测
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={!bash?.suggestedShellPath}
                      onClick={async () => {
                        const status = await window.xAgent.applyBashShellPath(
                          bash?.suggestedShellPath ?? undefined,
                        );
                        setBash(status);
                        onBashChanged?.(status);
                        setGeneralMsg(status.message);
                      }}
                    >
                      写入建议路径
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={async () => {
                        const picked = await window.xAgent.pickBashShell();
                        if (picked.canceled || !picked.path) return;
                        const status = await window.xAgent.applyBashShellPath(
                          picked.path,
                        );
                        setBash(status);
                        onBashChanged?.(status);
                        setGeneralMsg(status.message);
                      }}
                    >
                      浏览…
                    </button>
                  </div>
                  {bash?.suggestedShellPath &&
                    bash.suggestedShellPath !== bash.shellPath && (
                      <p className="modal-hint">
                        建议路径：{bash.suggestedShellPath}
                      </p>
                    )}
                </div>

                <div className="settings-block">
                  <h4 className="settings-block-title">认证</h4>
                  <p className="modal-hint">
                    可用 Pi CLI 的 /login，或在「供应商」页配置 API Key。
                  </p>
                  <div className="settings-inline-row">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={piLoginBusy}
                      onClick={async () => {
                        setPiLoginBusy(true);
                        setAuthHint(null);
                        try {
                          const result = await window.xAgent.openPiLogin();
                          setAuthHint(
                            result.hint ??
                              (result.ok
                                ? "已打开终端"
                                : result.error ?? "无法打开 Pi 登录"),
                          );
                          if (!result.ok && result.error) {
                            setGeneralMsg(result.error);
                          }
                        } finally {
                          setPiLoginBusy(false);
                        }
                      }}
                    >
                      {piLoginBusy ? "打开中…" : "打开 Pi 登录"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => onOpenProviders()}
                    >
                      前往供应商
                    </button>
                  </div>
                  {authHint && (
                    <SettingsNotice
                      text={authHint}
                      onDismiss={() => setAuthHint(null)}
                    />
                  )}
                </div>

                <div className="settings-block">
                  <h4 className="settings-block-title">更新</h4>
                  <div className="settings-row">
                    <span className="settings-row-label">更新源</span>
                    <SelectMenu
                      variant="control"
                      value={prefs.updateSource ?? "github"}
                      options={[
                        { value: "github", label: "GitHub" },
                        { value: "gitee", label: "Gitee" },
                      ]}
                      onChange={(v) => {
                        void (async () => {
                          const next = await window.xAgent.setPrefs({
                            updateSource: v as UpdateSource,
                          });
                          onPrefsChanged?.(next);
                          setUpdateStatus(await window.xAgent.getUpdateStatus());
                        })();
                      }}
                      aria-label="更新源"
                    />
                  </div>
                  <p className="modal-hint">
                    {prefs.updateSource === "gitee"
                      ? "Gitee：适合国内网络。需发版 CI 配置 GITEE_TOKEN 同步滚动标签 latest（含 latest.yml）。"
                      : "GitHub：默认源，从 GitHub Releases 拉取更新。"}
                  </p>
                  <p className="modal-hint">
                    {updateStatus?.message ??
                      (prefs.updateSource === "gitee"
                        ? "检查 Gitee Releases 上的新版本。"
                        : "检查 GitHub Releases 上的新版本。")}
                    {updateStatus?.version
                      ? `（当前目标：${updateStatus.version}）`
                      : ""}
                    {typeof updateStatus?.progress === "number" &&
                    updateStatus.downloading
                      ? ` ${updateStatus.progress}%`
                      : ""}
                  </p>
                  <div className="settings-inline-row">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={
                        updateBusy ||
                        updateStatus?.checking ||
                        updateStatus?.downloading
                      }
                      onClick={async () => {
                        setUpdateBusy(true);
                        try {
                          setUpdateStatus(
                            await window.xAgent.checkForUpdates(),
                          );
                        } finally {
                          setUpdateBusy(false);
                        }
                      }}
                    >
                      {updateStatus?.checking ? "检查中…" : "检查更新"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={
                        updateBusy ||
                        !updateStatus?.available ||
                        updateStatus.downloaded ||
                        updateStatus.downloading ||
                        !updateStatus.supported
                      }
                      onClick={async () => {
                        setUpdateBusy(true);
                        try {
                          setUpdateStatus(await window.xAgent.downloadUpdate());
                        } finally {
                          setUpdateBusy(false);
                        }
                      }}
                    >
                      {updateStatus?.downloading ? "下载中…" : "下载更新"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={
                        updateBusy ||
                        !updateStatus?.downloaded ||
                        !updateStatus.supported
                      }
                      onClick={async () => {
                        setUpdateBusy(true);
                        try {
                          const result = await window.xAgent.installUpdate();
                          if (!result.ok) {
                            setGeneralMsg(result.error ?? "安装失败");
                          }
                        } finally {
                          setUpdateBusy(false);
                        }
                      }}
                    >
                      安装并重启
                    </button>
                  </div>
                  {updateStatus?.error && (
                    <p className="modal-hint settings-error">
                      {updateStatus.error}
                    </p>
                  )}
                </div>

                {generalMsg && (
                  <SettingsNotice
                    text={generalMsg}
                    tone={
                      /失败|错误|无法|未找到|不可用/.test(generalMsg)
                        ? "error"
                        : "neutral"
                    }
                    onDismiss={() => setGeneralMsg(null)}
                  />
                )}
              </section>
  );
}
