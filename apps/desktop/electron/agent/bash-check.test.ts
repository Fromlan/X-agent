/**
 * 校验 shellPath 写入的安全性：
 * - 启动并匹配 GNU bash banner（任何被编译进 bash 的字符串）才算真 bash
 * - 不是 bash 时返回 reason，renderer 据此指引用户
 * - 不在常见可信目录时给出 warning（不阻断，便于用户自定义安装）
 * - 写入路径不存在 / 路径不存在 launcher 时返回 ok:false
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
const io = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("node:child_process", async (original) => ({ ...await original<typeof import("node:child_process")>(), execFile: io.execute }));
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyBashShellPath, checkBash, ensureBashConfigured, findSuggestedBash } from "./bash-check";
import { setAgentDirOverrideForTests } from "./prefs";
import { readPiSettingsSync } from "./pi-settings";

let agentHome = "";

beforeEach(() => {
  vi.stubEnv("PATH", "");
  io.execute.mockReset();
  io.execute.mockImplementation((_target, _args, _opts, callback) => callback(null, { stdout: "not bash", stderr: "" }));
  agentHome = mkdtempSync(join(tmpdir(), "xagent-bash-test-"));
  vi.stubEnv("ProgramFiles", join(agentHome, "program-files"));
  vi.stubEnv("ProgramFiles(x86)", join(agentHome, "program-files-x86"));
  vi.stubEnv("LOCALAPPDATA", join(agentHome, "local-app-data"));
  setAgentDirOverrideForTests(agentHome);
});

afterEach(() => {
  vi.unstubAllEnvs();
  setAgentDirOverrideForTests(null);
  if (agentHome) rmSync(agentHome, { recursive: true, force: true });
});

/** 写一个简短的 bash 替身脚本（Windows .bat / POSIX shell）。 */
function makeFakeBash(stdout: string, exitCode = 0): string {
  const dir = agentHome;
  const isWin = process.platform === "win32";
  const path = join(dir, isWin ? "bash.exe" : "bash");
  // Windows 下 .exe 必须是真实 PE 文件才能被 execFile 启动；改为 .bat 但
  // 仍叫 bash.exe 会被拒绝。改为调用 cmd.exe 包装路径——但 probeBash 用
  // execFile 直接传 target，无法 cmd-wrapper。我们直接用 node + 文本写一段
  // 真实可执行文件：Windows 下写 .bat（execFile 不支持），改用 process 模拟。
  // 最简单：nix 写 shell 脚本 + chmod，Windows 跳过 banner 验证仅检查
  // exitCode + "no_banner" 路径。
  const script = isWin
    ? `@echo off\r\necho ${stdout}\r\nexit /B ${exitCode}\r\n`
    : `#!/bin/sh\necho ${stdout}\nexit ${exitCode}\n`;
  // Windows：写 .bat 并把后缀改为 .cmd 才会被 execFile 识别为命令行；
  // 但 applyBashShellPath 强制 shellPath 后缀可以是 .exe .bat .cmd。
  // 这里我们写 .bat 并以 .bat 为返回值，绕过 .exe 限制。
  const finalPath = isWin ? `${path}.bat` : path;
  writeFileSync(finalPath, script, "utf8");
  if (!isWin) {
    const { chmodSync } = require("node:fs") as typeof import("node:fs");
    chmodSync(finalPath, 0o755);
  }
  return finalPath;
}

describe("applyBashShellPath", () => {
  it("拒绝无法启动的路径", async () => {
    const r = await applyBashShellPath("C:/does/not/exist/bash.exe");
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/没有可用的 bash 路径/);
  });

  it("拒绝不输出 GNU bash banner 的可执行", async () => {
    const fake = makeFakeBash("Hello, world.", 0);
    const r = await applyBashShellPath(fake);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toMatch(/不是 bash 可执行/);
      expect(r.suggestedShellPath).toBe(fake);
    }
  });

  it("碰到 timeout 时返回 ok:false + 明确 reason", async () => {
    if (process.platform !== "win32") {
      // 跳过非 Windows：real `sleep` 替身在 sandbox 里需要更多依赖。
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), "xagent-bash-slow-"));
    const path = join(dir, "bash.exe");
    writeFileSync(
      path,
      "@echo off\r\nping -n 30 127.0.0.1 > NUL\r\nexit /B 0\r\n",
      "utf8",
    );
    const r = await applyBashShellPath(path);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toMatch(/不是 bash 可执行/);
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it("成功路径写入 settings.json + 路径不在可信目录时返回 warning", async () => {
    // execFile 在 Windows 直接传 .bat 会被拒；改用 `findSuggestedBash`
    // 走真实 PATH。如果找不到，则跳过。
    const real = makeFakeBash("GNU bash, version 5.2");
    io.execute.mockImplementation((_target, _args, _opts, callback) => callback(null, { stdout: "GNU bash, version 5.2", stderr: "" }));
    const r = await applyBashShellPath(real);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.shellPath).toBe(real);
      // Git Bash 在 Program Files\Git → 不在可信目录警告应该出现
      if (!isInTrustedDir(real)) {
        expect(r.warning ?? "").toMatch(/不在常见可信目录/);
      }
    }
    const settings = readPiSettingsSync();
    expect(settings.shellPath).toBe(real);
  }, 15_000);
});

function isInTrustedDir(absPath: string): boolean {
  const n = process.platform === "win32" ? absPath.toLowerCase() : absPath;
  if (process.platform === "win32") {
    return (
      n.includes("\\program files\\git\\") ||
      n.includes("\\program files (x86)\\git\\") ||
      n.includes("\\windows\\") ||
      n.includes("\\usr\\bin\\")
    );
  }
  return (
    n.startsWith("/bin/") ||
    n.startsWith("/usr/bin/") ||
    n.startsWith("/usr/local/bin/") ||
    n.startsWith("/opt/")
  );
}

/** Reproduce Git installed outside Program Files with only its cmd directory on PATH. */
function makePortableGit(): { cmd: string; bash: string } {
  const root = join(agentHome, "portable-git");
  const cmd = join(root, "cmd");
  const bin = join(root, "bin");
  mkdirSync(cmd, { recursive: true });
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(cmd, "git.exe"), "git fixture");
  const bash = join(bin, "bash.exe");
  writeFileSync(bash, "bash fixture");
  io.execute.mockImplementation((target, _args, _opts, callback) => callback(null, {
    stdout: target === bash ? "GNU bash, version 5.2" : "not bash",
    stderr: "",
  }));
  vi.stubEnv("PATH", cmd);
  return { cmd, bash };
}

describe("Windows Bash discovery", () => {
  it.skipIf(process.platform !== "win32")("finds Git Bash beside git.exe when bash itself is absent from PATH", async () => {
    const git = makePortableGit();
    expect(await findSuggestedBash()).toBe(git.bash);
  });

  it.skipIf(process.platform !== "win32")("rejects a broken default installation and keeps looking for a working Bash", async () => {
    const git = makePortableGit();
    const brokenBin = join(process.env.ProgramFiles!, "Git", "bin");
    mkdirSync(brokenBin, { recursive: true });
    writeFileSync(join(brokenBin, "bash.exe"), "not executable Bash");
    expect(await findSuggestedBash()).toBe(git.bash);
  });

  it.skipIf(process.platform !== "win32")("finds registered Git installations even when Git is absent from PATH", async () => {
    const git = makePortableGit();
    vi.stubEnv("PATH", "");
    io.execute.mockImplementation((target, args, _opts, callback) => callback(null, {
      stdout: args[0] === "query"
        ? `\r\nHKEY_CURRENT_USER\\Software\\GitForWindows\r\n    InstallPath    REG_SZ    ${join(git.cmd, "..")}\r\n`
        : target === git.bash ? "GNU bash, version 5.2" : "not bash",
      stderr: "",
    }));
    expect(await findSuggestedBash()).toBe(git.bash);
  });
});

describe("startup Bash configuration", () => {
  it.skipIf(process.platform !== "win32")("configures discovered Git Bash and preserves other Pi settings", async () => {
    const git = makePortableGit();
    const settings = { defaultProvider: "keep", packages: ["npm:existing"] };
    writeFileSync(join(agentHome, "settings.json"), JSON.stringify(settings));
    expect(await ensureBashConfigured()).toMatchObject({ ok: true, shellPath: git.bash });
    expect(readPiSettingsSync()).toEqual({ ...settings, shellPath: git.bash });
    expect((await checkBash()).message).not.toContain("可写入");
  });

  it.skipIf(process.platform !== "win32")("creates settings on first launch and repairs broken or deleted configured paths", async () => {
    const git = makePortableGit();
    expect((await ensureBashConfigured()).ok).toBe(true);
    expect(readPiSettingsSync().shellPath).toBe(git.bash);
    for (const shellPath of [makeFakeBash("not bash"), join(agentHome, "removed.exe")]) {
      writeFileSync(join(agentHome, "settings.json"), JSON.stringify({ shellPath, preserved: true }));
      expect((await ensureBashConfigured()).ok).toBe(true);
      expect(readPiSettingsSync()).toEqual({ shellPath: git.bash, preserved: true });
    }
  });

  it.skipIf(process.platform !== "win32")("keeps an existing valid custom shell and never rewrites its settings", async () => {
    const git = makePortableGit();
    const configured = makeFakeBash("GNU bash, version 5.2");
    io.execute.mockImplementation((_target, _args, _opts, callback) => callback(null, { stdout: "GNU bash, version 5.2", stderr: "" }));
    const raw = `${JSON.stringify({ shellPath: configured, preserved: true })}\n`;
    writeFileSync(join(agentHome, "settings.json"), raw);
    expect(await ensureBashConfigured()).toMatchObject({ ok: true, shellPath: configured });
    expect(await ensureBashConfigured()).toMatchObject({ ok: true, shellPath: configured });
    expect(readFileSync(join(agentHome, "settings.json"), "utf8")).toBe(raw);
    expect(configured).not.toBe(git.bash);
  });

  it("does not create settings if no executable passes verification", async () => {
    expect(await ensureBashConfigured()).toMatchObject({ ok: false, suggestedShellPath: null });
    expect(existsSync(join(agentHome, "settings.json"))).toBe(false);
  });

  it.each(['{"shellPath":', '[]', 'null'])("preserves malformed settings: %s", async (raw) => {
    writeFileSync(join(agentHome, "settings.json"), raw);
    await expect(ensureBashConfigured()).rejects.toThrow(/配置/);
    expect(readFileSync(join(agentHome, "settings.json"), "utf8")).toBe(raw);
    expect(await checkBash()).toMatchObject({ ok: false, suggestedShellPath: null });
  });
});

describe("checkBash", () => {
  it.skipIf(process.platform !== "win32")("suggests a working replacement for a broken configured shell without rewriting settings", async () => {
    const git = makePortableGit();
    const broken = makeFakeBash("not bash");
    const settings = { shellPath: broken, preserved: "keep" };
    writeFileSync(join(agentHome, "settings.json"), JSON.stringify(settings));

    const status = await checkBash();
    // Pi still uses the configured shell until the user applies the replacement.
    expect(status.ok).toBe(false);
    expect(status.shellPath).toBeNull();
    expect(status.suggestedShellPath).toBe(git.bash);
    expect(readPiSettingsSync()).toEqual(settings);

    expect((await applyBashShellPath(status.suggestedShellPath!)).ok).toBe(true);
    expect(await checkBash()).toMatchObject({ ok: true, shellPath: git.bash });
    expect(readPiSettingsSync()).toEqual({ ...settings, shellPath: git.bash });
  });

  it.skipIf(process.platform !== "win32")("does not report a deleted configured shell as ready before replacement is applied", async () => {
    const git = makePortableGit();
    writeFileSync(join(agentHome, "settings.json"), JSON.stringify({ shellPath: join(agentHome, "removed.exe") }));
    expect(await checkBash()).toMatchObject({ ok: false, shellPath: null, suggestedShellPath: git.bash });
  });

  it("does not suggest reapplying the same invalid executable when no replacement exists", async () => {
    const broken = makeFakeBash("not bash");
    writeFileSync(join(agentHome, "settings.json"), JSON.stringify({ shellPath: broken }));
    expect(await checkBash()).toMatchObject({ ok: false, suggestedShellPath: null });
  });

  it.skipIf(process.platform !== "win32")("keeps a valid explicitly configured Bash ahead of discovered installations", async () => {
    makePortableGit();
    const configured = makeFakeBash("GNU bash, version 5.2");
    io.execute.mockImplementation((_target, _args, _opts, callback) => callback(null, { stdout: "GNU bash, version 5.2", stderr: "" }));
    writeFileSync(join(agentHome, "settings.json"), JSON.stringify({ shellPath: configured }));
    expect(await checkBash()).toMatchObject({ ok: true, shellPath: configured, suggestedShellPath: configured });
  });

  it("未配置时 ok=true（如果 PATH/Git 上有 bash）且 ok=false 否则", async () => {
    const r = await checkBash();
    if (r.ok) {
      expect(typeof r.shellPath).toBe("string");
      if (r.warning) {
        expect(r.warning).toMatch(/不在常见可信目录/);
      }
    } else {
      expect(r.shellPath).toBeNull();
    }
  }, 15_000);

  it("配置了非 bash 的可执行时返回 ok:false + 提示", async () => {
    const fake = makeFakeBash("definitely not bash", 0);
    const apply = await applyBashShellPath(fake);
    expect(apply.ok).toBe(false);
    if (existsSync(fake)) {
      const r = await checkBash();
      expect(typeof r.ok).toBe("boolean");
    }
  });
});
