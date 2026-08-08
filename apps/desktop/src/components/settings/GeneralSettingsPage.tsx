import { useEffect, useState } from "react";
import { SelectMenu } from "../SelectMenu";
import { SettingsNotice, useAutoClearNotice } from "../SettingsNotice";
import {
  THEME_IDS,
  THEME_LABELS,
  THINKING_LEVELS,
  type BashCheckResult,
  type BashLivenessResult,
  type ClientPrefs,
  type ColorMode,
  type GitCheckResult,
  type PiCliStatus,
  type ThemeId,
  type ThinkingLevel,
} from "@shared/ipc";
import {
  GIT_FOR_WINDOWS_DOWNLOAD_URL,
  NODE_JS_DOWNLOAD_URL,
} from "@shared/runtime-deps";
import { useAppUpdate } from "../../hooks/useAppUpdate";

type Props = {
  open: boolean;
  prefs: ClientPrefs;
  onPrefsChanged?: (prefs: ClientPrefs) => void;
  onBashChanged?: (bash: BashCheckResult) => void;
  onGitChanged?: (git: GitCheckResult) => void;
  onPiCliChanged?: (piCli: PiCliStatus) => void;
  onOpenProviders: () => void;
};

export function GeneralSettingsPage({
  open,
  prefs,
  onPrefsChanged,
  onBashChanged,
  onGitChanged,
  onPiCliChanged,
  onOpenProviders,
}: Props) {
  const [bash, setBash] = useState<BashCheckResult | null>(null);
  const [bashLiveness, setBashLiveness] =
    useState<BashLivenessResult | null>(null);
  const [bashLivenessBusy, setBashLivenessBusy] = useState(false);
  const [git, setGit] = useState<GitCheckResult | null>(null);
  const [piCli, setPiCli] = useState<PiCliStatus | null>(null);
  const [generalMsg, setGeneralMsg] = useState<string | null>(null);
  const [authHint, setAuthHint] = useState<string | null>(null);
  const [piLoginBusy, setPiLoginBusy] = useState(false);
  const [piInstallBusy, setPiInstallBusy] = useState(false);
  const {
    status: updateStatus,
    busy: updateBusy,
    check: checkUpdates,
    download: downloadUpdate,
    install: installUpdate,
  } = useAppUpdate({
    enabled: open,
    onError: (message) => setGeneralMsg(message),
  });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const [bashStatus, gitStatus, piStatus] = await Promise.all([
          window.xAgent.prefs.checkBash(),
          window.xAgent.prefs.checkGit(),
          window.xAgent.prefs.checkPiCli(),
        ]);
        if (cancelled) return;
        setBash(bashStatus);
        setGit(gitStatus);
        setPiCli(piStatus);
        onBashChanged?.(bashStatus);
        onGitChanged?.(gitStatus);
        onPiCliChanged?.(piStatus);
      } catch {
        // D10: 诊断 IPC 异常时保持空状态，避免 unhandled rejection。
      }
    })();
    return () => {
      cancelled = true;
    };
    // Intentionally only re-run when the page opens; callbacks are optional paint syncs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) {
      setGeneralMsg(null);
      setAuthHint(null);
    }
  }, [open]);

  useAutoClearNotice(generalMsg, () => setGeneralMsg(null));
  useAutoClearNotice(authHint, () => setAuthHint(null));

  const openGitDownloadPage = async () => {
    const result = await window.xAgent.openExternalUrl(
      GIT_FOR_WINDOWS_DOWNLOAD_URL,
    );
    setGeneralMsg(
      result.ok
        ? "已打开 Git 下载页。安装完成后请点击「检测」。"
        : (result.error ?? "无法打开 Git 下载页"),
    );
  };

  const openNodeDownloadPage = async () => {
    const result = await window.xAgent.openExternalUrl(NODE_JS_DOWNLOAD_URL);
    setGeneralMsg(
      result.ok
        ? "已打开 Node.js 下载页。安装 22+ 并确保 npm 在 PATH 后，再安装 Pi CLI。"
        : (result.error ?? "无法打开 Node.js 下载页"),
    );
  };
  return (
              <section className="settings-page">
                <div className="settings-page-head">
                  <h3>通用</h3>
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
                          const next = await window.xAgent.prefs.set({
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
                          const next = await window.xAgent.prefs.set({
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
                        const next = await window.xAgent.prefs.set({
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
                        label: level.charAt(0).toUpperCase() + level.slice(1),
                      }))}
                      onChange={(v) => {
                        void (async () => {
                          const level = v as ThinkingLevel;
                          // Persist preference first so it survives even when no
                          // session is open (setThinkingLevel requires a session).
                          let next = await window.xAgent.prefs.set({
                            thinkingLevel: level,
                          });
                          const applied =
                            await window.xAgent.setThinkingLevel(level);
                          if (applied.ok) {
                            // Session path may clamp (e.g. DeepSeek V4 medium→high).
                            next = await window.xAgent.prefs.get();
                            onPrefsChanged?.(next);
                            setGeneralMsg(null);
                            return;
                          }
                          onPrefsChanged?.(next);
                          setGeneralMsg(
                            "已保存默认 Thinking；打开项目后对当前会话生效。",
                          );
                        })();
                      }}
                      aria-label="默认 Thinking 级别"
                    />
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">目标最大轮次</span>
                    <input
                      type="number"
                      className="settings-input settings-input-narrow"
                      min={1}
                      max={200}
                      value={prefs.goalMaxTurns}
                      title="Goal 模式自动续轮上限；用尽后可提高再继续"
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        void (async () => {
                          const next = await window.xAgent.prefs.set({
                            goalMaxTurns: n,
                          });
                          onPrefsChanged?.(next);
                        })();
                      }}
                      aria-label="目标模式最大自动续轮次数"
                    />
                  </div>
                  <div className="settings-row">
                    <span className="settings-row-label">目标最大 token</span>
                    <input
                      type="number"
                      className="settings-input settings-input-narrow"
                      min={10000}
                      max={10000000}
                      step={10000}
                      value={prefs.goalMaxTokens}
                      title="Goal 模式累计 token 上限（含缓存）；用尽后可提高再继续"
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        void (async () => {
                          const next = await window.xAgent.prefs.set({
                            goalMaxTokens: n,
                          });
                          onPrefsChanged?.(next);
                        })();
                      }}
                      aria-label="目标模式最大累计 token"
                    />
                  </div>
                </div>

                <div className="settings-block">
                  <h4 className="settings-block-title">Shell</h4>
                  <p className="modal-hint">
                    bash 路径写入 ~/.pi/agent/settings.json（Windows 常用 Git Bash）。
                    文件工具受项目 cwd 沙箱约束；调研/Plan 的 bash 也会拦截目录外路径。
                    Agent 模式下 bash 仍可能访问 cwd 外，请谨慎授权。
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
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={!bash?.shellPath || bashLivenessBusy}
                      title="跑一个 2 秒探针，区分 live / half-dead / full-dead / no-bash"
                      onClick={async () => {
                        setBashLivenessBusy(true);
                        try {
                          const result = await window.xAgent.prefs.checkBashLiveness();
                          setBashLiveness(result);
                          setGeneralMsg(result.message);
                        } finally {
                          setBashLivenessBusy(false);
                        }
                      }}
                    >
                      {bashLivenessBusy ? "诊断中…" : "诊断"}
                    </button>
                    {bash && !bash.ok && !bash.suggestedShellPath && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                          void openGitDownloadPage();
                        }}
                      >
                        下载 Git for Windows
                      </button>
                    )}
                  </div>
                  {bash?.suggestedShellPath &&
                    bash.suggestedShellPath !== bash.shellPath && (
                      <p className="modal-hint">
                        建议路径：{bash.suggestedShellPath}
                      </p>
                    )}
                  {bashLiveness && (
                    <div className="modal-hint bash-liveness-hint" data-kind={bashLiveness.kind}>
                      <strong>
                        诊断结果：
                        <span className={`settings-status ${bashLivenessTone(bashLiveness.kind)}`}>
                          {bashLivenessLabel(bashLiveness.kind)}
                        </span>
                      </strong>
                      <span className="bash-liveness-detail">{bashLiveness.message}</span>
                      {bashLiveness.kind === "half_dead" && (
                        <span className="bash-liveness-detail">
                          半死状态可继续用：写文件、git commit 这类有副作用的命令仍能成功。
                          AI 看不到输出时，请用「文件副作用」验证（命令写文件 → read 工具读文件确认）。
                        </span>
                      )}
                      {bashLiveness.kind === "full_dead" && (
                        <span className="bash-liveness-detail">
                          建议：重启 X-agent，或重新指定 bash 路径。
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div className="settings-block">
                  <h4 className="settings-block-title">Git</h4>
                  <p className="modal-hint">工作区检查点需要 git。</p>
                  <div className="settings-inline-row">
                    <input
                      type="text"
                      className="input input-mono"
                      readOnly
                      value={git?.gitPath ?? ""}
                      placeholder="尚未检测到 git…"
                      aria-label="当前 git 路径"
                    />
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={async () => {
                        const status = await window.xAgent.prefs.checkGit();
                        setGit(status);
                        onGitChanged?.(status);
                        setGeneralMsg(status.message);
                      }}
                    >
                      检测
                    </button>
                    {git && !git.ok && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                          void openGitDownloadPage();
                        }}
                      >
                        下载 Git for Windows
                      </button>
                    )}
                  </div>
                </div>

                <div className="settings-block">
                  <h4 className="settings-block-title">认证</h4>
                  <p className="modal-hint">
                    Pi CLI /login，或在「供应商」配置 API Key。
                    {piCli && !piCli.ok
                      ? piCli.canInstall
                        ? " 未检测到 Pi CLI，可一键安装。"
                        : " 需先安装 Node.js 22+（含 npm）。"
                      : null}
                  </p>
                  <div className="settings-inline-row">
                    {piCli && !piCli.ok && !piCli.canInstall && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                          void openNodeDownloadPage();
                        }}
                      >
                        打开 Node 下载页
                      </button>
                    )}
                    {piCli && !piCli.ok && piCli.canInstall && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={piInstallBusy}
                        onClick={async () => {
                          setPiInstallBusy(true);
                          try {
                            const status = await window.xAgent.installPiCli();
                            setPiCli(status);
                            onPiCliChanged?.(status);
                            setGeneralMsg(status.message);
                          } finally {
                            setPiInstallBusy(false);
                          }
                        }}
                      >
                        {piInstallBusy ? "安装中…" : "安装 Pi CLI"}
                      </button>
                    )}
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
                  <p className="modal-hint">
                    {updateStatus?.message ??
                      "安装版会静默检查更新；失败可打开 Releases。"}
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
                      onClick={() => {
                        void checkUpdates();
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
                      onClick={() => {
                        void downloadUpdate();
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
                      onClick={() => {
                        void installUpdate();
                      }}
                    >
                      安装并重启
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        void (async () => {
                          const url =
                            updateStatus?.releasesUrl ??
                            "https://github.com/Fromlan/X-agent/releases";
                          const result =
                            await window.xAgent.openExternalUrl(url);
                          if (!result.ok) {
                            setGeneralMsg(
                              result.error ?? "无法打开 GitHub Releases",
                            );
                          }
                        })();
                      }}
                    >
                      打开 Releases
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        void (async () => {
                          const result = await window.xAgent.openExternalUrl(
                            "https://qm.qq.com/q/lY3yUwyF0I",
                          );
                          if (!result.ok) {
                            setGeneralMsg(result.error ?? "无法打开加群链接");
                          }
                        })();
                      }}
                    >
                      加群下载
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

function bashLivenessLabel(kind: BashLivenessResult["kind"]): string {
  switch (kind) {
    case "live":
      return "正常";
    case "half_dead":
      return "半死（命令能执行但输出回不来）";
    case "full_dead":
      return "全死（命令也无法完成）";
    case "no_bash":
      return "未找到 bash";
  }
}

/** D1: 状态用色点（settings-status 的 is-ok/is-warn/is-error/is-off），不用 emoji。 */
function bashLivenessTone(kind: BashLivenessResult["kind"]): string {
  switch (kind) {
    case "live":
      return "is-ok";
    case "half_dead":
      return "is-warn";
    case "full_dead":
      return "is-error";
    case "no_bash":
      return "is-off";
  }
}
