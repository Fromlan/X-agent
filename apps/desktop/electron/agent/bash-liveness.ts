/**
 * Bash "liveness" probe — distinguishes a real bash failure from the
 * silent / "half-dead" state where commands execute and produce file
 * side-effects, but the caller's stdout is never returned. The latter
 * was observed in the wild with pi-coding-agent's bash tool when the
 * upstream pipe gets dropped.
 *
 * What it does:
 *   1. Picks the `shellPath` Pi will use (configured → suggested) so we
 *      test the same binary the AI tool invokes.
 *   2. Runs `bash -lc <script>` printing a unique stdout marker AND writing
 *      the same marker to a probe file. `-l` mirrors Pi's login-shell
 *      invocation, so PATH/env mismatches bite the probe too.
 *   3. Reads the probe file via `fs` (independent of the bash stdout pipe).
 *   4. Cleans up the probe file on every exit branch.
 *
 * Result `kind`:
 *   - `live`       — bash ran, wrote the file, stdout carried the marker.
 *   - `half_dead`  — bash ran and wrote the file, but stdout was eaten.
 *   - `full_dead`  — bash did not produce the probe (timeout / non-zero /
 *                    wrong content).
 *   - `no_bash`    — no usable bash path; user needs to install/configure.
 *
 * We deliberately do NOT route through the AI's bash tool — the bug being
 * measured lives inside that tool, so the probe must use execFile directly.
 */
import { execFile } from "node:child_process";
import { access, mkdir, readFile, rm } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { BashLivenessResult } from "../../shared/ipc";

const execFileAsync = promisify(execFile);
// 探针超时：Windows 上 Git for Windows 首次冷启动 + Defender 扫描可能超过
// 2s，过激超时会把健康 bash 误报为 full_dead（CI 冷启动实测即触发）。
const PROBE_TIMEOUT_MS = 10_000;

function buildProbeScript(marker: string, probePath: string): string {
  return [
    `__MARK='${marker}'`,
    `__PROBE='${probePath}'`,
    `printf 'PROBE_STDOUT_%s\n' "$__MARK"`,
    `printf 'PROBE_STDERR_%s\n' "$__MARK" 1>&2`,
    `printf 'probe_alive_%s\n' "$__MARK" > "$__PROBE"`,
    `echo "__OK__"`,
  ].join("\n");
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveBash(
  configured: string | null | undefined,
  findSuggested: () => Promise<string | null>,
): Promise<string | null> {
  if (configured && (await isExecutable(configured))) return configured;
  const suggested = await findSuggested();
  if (suggested && (await isExecutable(suggested))) return suggested;
  return null;
}

async function readProbeFile(probePath: string): Promise<string | null> {
  try {
    return await readFile(probePath, "utf8");
  } catch {
    return null;
  }
}

interface ProbeOutcome {
  kind: BashLivenessResult["kind"];
  message: string;
  stdout: string;
  stderr: string;
  ranSomething: boolean;
  timedOut: boolean;
  exitNonZero: boolean;
}

async function runProbe(shellPath: string, cwd: string | null): Promise<ProbeOutcome> {
  const marker = randomBytes(8).toString("hex");
  const probeDir = join(tmpdir(), "x-agent-bash-probe");
  await mkdir(probeDir, { recursive: true });
  const probePath = join(probeDir, `probe-${marker}.txt`);
  const script = buildProbeScript(marker, probePath);

  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let exitNonZero = false;
  let spawnedOk = true;

  try {
    const result = await execFileAsync(shellPath, ["-lc", script], {
      cwd: cwd ?? undefined,
      timeout: PROBE_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 256 * 1024,
    });
    stdout = result.stdout ?? "";
    stderr = result.stderr ?? "";
  } catch (err) {
    const e = err as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      killed?: boolean;
      code?: string | number;
    };
    stdout = e.stdout ?? "";
    stderr = e.stderr ?? "";
    if (e.killed || e.code === "ETIMEDOUT") {
      timedOut = true;
    } else if (typeof e.code === "number" && e.code !== 0) {
      exitNonZero = true;
    } else if (typeof e.code === "string" && e.code !== "OK") {
      spawnedOk = false;
      return {
        kind: "no_bash",
        message: `bash 探针 spawn 失败：${e.code} ${e.message ?? ""}`,
        stdout,
        stderr,
        ranSomething: false,
        timedOut: false,
        exitNonZero: false,
      };
    }
  }

  const probeBody = await readProbeFile(probePath);
  const fileOk = !!probeBody && probeBody.trim() === `probe_alive_${marker}`;
  const stdoutOk = stdout.includes(`PROBE_STDOUT_${marker}`);

  let kind: ProbeOutcome["kind"];
  let message: string;
  if (fileOk && stdoutOk) {
    kind = "live";
    message = "bash 完整工作：命令和 stdout 都正常回传。";
  } else if (fileOk && !stdoutOk) {
    kind = "half_dead";
    message =
      "bash 命令能执行（探针文件已写入），但 stdout 没有回传——属于半死状态。AI 看不到输出，但写文件、git commit 这类副作用仍生效。";
  } else if (timedOut) {
    kind = "full_dead";
    message = `bash 超过 ${PROBE_TIMEOUT_MS}ms 未返回，疑似完全卡死。`;
  } else if (exitNonZero) {
    kind = "full_dead";
    message = "bash 退出码非 0，探针文件未生成。";
  } else if (probeBody === null) {
    kind = "full_dead";
    message = "bash 已退出但未生成探针文件。";
  } else {
    kind = "full_dead";
    message = "bash 写入的探针内容与预期不符，状态不可信。";
  }

  // Fire-and-forget cleanup so we never block the IPC return on fs I/O.
  void rm(probePath, { force: true }).catch(() => {});
  void marker; // marker is part of message context for log correlation
  return {
    kind,
    message,
    stdout,
    stderr,
    ranSomething: spawnedOk,
    timedOut,
    exitNonZero,
  };
}

/**
 * Public entry.
 * - `configuredShellPath` — value from `~/.pi/agent/settings.json` if present.
 * - `findSuggested`        — file-system scan; tests inject a stub.
 * - `shellOverride`        — test hook to force a specific binary path.
 */
export async function probeBashLiveness(opts: {
  configuredShellPath?: string | null;
  cwd?: string | null;
  findSuggested?: () => Promise<string | null>;
  shellOverride?: string | null;
}): Promise<BashLivenessResult> {
  const findSuggested = opts.findSuggested ?? (async () => null);
  const shellPath =
    opts.shellOverride !== undefined
      ? opts.shellOverride
      : await resolveBash(opts.configuredShellPath ?? null, findSuggested);

  if (!shellPath) {
    return {
      kind: "no_bash",
      ok: false,
      shellPath: null,
      message:
        "未找到可执行的 bash。请先安装 Git for Windows 并配置 shellPath。",
      marker: "",
      probePath: "",
      ranSomething: false,
      timedOut: false,
      exitNonZero: false,
      stdoutPreview: "",
      stderrPreview: "",
    };
  }

  const outcome = await runProbe(shellPath, opts.cwd ?? null);
  return {
    kind: outcome.kind,
    ok: outcome.kind === "live" || outcome.kind === "half_dead",
    shellPath,
    message: outcome.message,
    marker: "",
    probePath: "",
    ranSomething: outcome.ranSomething,
    timedOut: outcome.timedOut,
    exitNonZero: outcome.exitNonZero,
    stdoutPreview: outcome.stdout.slice(0, 200),
    stderrPreview: outcome.stderr.slice(0, 200),
  };
}
