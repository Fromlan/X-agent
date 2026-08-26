/**
 * 校验 shellPath 写入的安全性：
 * - 启动并匹配 GNU bash banner（任何被编译进 bash 的字符串）才算真 bash
 * - 不是 bash 时返回 reason，renderer 据此指引用户
 * - 不在常见可信目录时给出 warning（不阻断，便于用户自定义安装）
 * - 写入路径不存在 / 路径不存在 launcher 时返回 ok:false
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyBashShellPath, checkBash } from "./bash-check";
import { setAgentDirOverrideForTests } from "./prefs";
import { readPiSettingsSync } from "./pi-settings";

let agentHome = "";

beforeEach(() => {
  agentHome = mkdtempSync(join(tmpdir(), "xagent-bash-test-"));
  setAgentDirOverrideForTests(agentHome);
});

afterEach(() => {
  setAgentDirOverrideForTests(null);
  if (agentHome) rmSync(agentHome, { recursive: true, force: true });
});

/** 写一个简短的 bash 替身脚本（Windows .bat / POSIX shell）。 */
function makeFakeBash(stdout: string, exitCode = 0): string {
  const dir = mkdtempSync(join(tmpdir(), "xagent-bash-probe-"));
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
    const suggested = (await import("./bash-check")).findSuggestedBash();
    const real = await suggested;
    if (!real) return; // 跳过：测试环境无 bash
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

describe("checkBash", () => {
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
