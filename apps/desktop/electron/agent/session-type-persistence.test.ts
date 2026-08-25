/**
 * Vitest 单元测试 — session-type sidecar persistence.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearSessionType,
  loadSessionType,
  saveSessionType,
} from "./session-type-persistence";

let tmpDir: string;
let fakeSessionPath: string;

beforeEach(() => {
  tmpDir = join(
    tmpdir(),
    `x-agent-stp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(tmpDir, { recursive: true });
  fakeSessionPath = join(tmpDir, "session-abc-123.json");
  writeFileSync(fakeSessionPath, "{}", "utf8");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("saveSessionType + loadSessionType", () => {
  it("design: 写后读一致", () => {
    saveSessionType(fakeSessionPath, "design");
    expect(loadSessionType(fakeSessionPath)).toBe("design");
  });

  it("code: 写后读一致", () => {
    saveSessionType(fakeSessionPath, "code");
    expect(loadSessionType(fakeSessionPath)).toBe("code");
  });

  it("多次写: 后写覆盖先写", () => {
    saveSessionType(fakeSessionPath, "code");
    saveSessionType(fakeSessionPath, "design");
    expect(loadSessionType(fakeSessionPath)).toBe("design");
  });

  it("sidecar 文件存在于 <sessionPath>.session-type.json", () => {
    saveSessionType(fakeSessionPath, "design");
    expect(existsSync(`${fakeSessionPath}.session-type.json`)).toBe(true);
  });
});

describe("loadSessionType fallback", () => {
  it("sidecar 不存在: 返回 DEFAULT_SESSION_TYPE (code)", () => {
    expect(loadSessionType(fakeSessionPath)).toBe("code");
  });

  it("sidecar 损坏 JSON: 返回 DEFAULT_SESSION_TYPE, 不抛", () => {
    writeFileSync(
      `${fakeSessionPath}.session-type.json`,
      "{ invalid json ...",
      "utf8",
    );
    expect(loadSessionType(fakeSessionPath)).toBe("code");
  });

  it("sidecar version 错误: 返回 DEFAULT_SESSION_TYPE", () => {
    writeFileSync(
      `${fakeSessionPath}.session-type.json`,
      JSON.stringify({ version: 99, sessionType: "design", updatedAt: 0 }),
      "utf8",
    );
    expect(loadSessionType(fakeSessionPath)).toBe("code");
  });

  it("sidecar sessionType 非法: 返回 DEFAULT_SESSION_TYPE", () => {
    writeFileSync(
      `${fakeSessionPath}.session-type.json`,
      JSON.stringify({
        version: 1,
        sessionType: "unknown-type",
        updatedAt: 0,
      }),
      "utf8",
    );
    expect(loadSessionType(fakeSessionPath)).toBe("code");
  });

  it("空 sessionPath: 返回 DEFAULT_SESSION_TYPE", () => {
    expect(loadSessionType("")).toBe("code");
  });
});

describe("clearSessionType", () => {
  it("写后清, 再次 load 返回 DEFAULT", () => {
    saveSessionType(fakeSessionPath, "design");
    expect(existsSync(`${fakeSessionPath}.session-type.json`)).toBe(true);
    clearSessionType(fakeSessionPath);
    expect(existsSync(`${fakeSessionPath}.session-type.json`)).toBe(false);
    expect(loadSessionType(fakeSessionPath)).toBe("code");
  });

  it("无 sidecar 时清除幂等, 不抛", () => {
    expect(() => clearSessionType(fakeSessionPath)).not.toThrow();
  });

  it("空 sessionPath: 幂等", () => {
    expect(() => clearSessionType("")).not.toThrow();
  });
});

describe("atomic write: 副作用", () => {
  it("写入成功不留 .tmp 残骸", () => {
    saveSessionType(fakeSessionPath, "design");
    // atomic-write 临时文件应已被 rename 走, 不应留 sibling .tmp
    const allFiles = require("node:fs").readdirSync(tmpDir);
    const tmpLeftover = allFiles.filter((f: string) => f.includes(".tmp"));
    expect(tmpLeftover).toEqual([]);
  });
});

describe("saveSessionType 非法输入", () => {
  it("非法 type 字符串: 静默不写, 不抛", () => {
    // @ts-expect-error 测试运行时错误路径
    saveSessionType(fakeSessionPath, "invalid-type");
    expect(existsSync(`${fakeSessionPath}.session-type.json`)).toBe(false);
  });
});
