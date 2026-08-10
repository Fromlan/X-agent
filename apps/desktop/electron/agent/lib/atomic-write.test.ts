/**
 * Vitest 单元测试 —— atomic-write 的 tmp/rename 原子行为。
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  writeJsonAtomic,
  writeJsonAtomicSync,
  readJsonAsync,
  fileExistsAsync,
} from "./atomic-write";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xagent-atomic-"));
});

afterEach(() => {
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
    dir = "";
  }
});

describe("writeJsonAtomic (async)", () => {
  it("成功路径生成合法 JSON", async () => {
    const path = join(dir, "x.json");
    await writeJsonAtomic(path, { hello: "world", n: 1 });
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    expect(parsed).toEqual({ hello: "world", n: 1 });
  });

  it("失败路径：目标目录不存在时抛出", async () => {
    const path = join(dir, "no-such-dir/x.json");
    await expect(writeJsonAtomic(path, { a: 1 })).rejects.toThrow();
  });

  it("成功后不残留 tmp 文件", async () => {
    const path = join(dir, "y.json");
    await writeJsonAtomic(path, { a: 1 });
    const all = readdirSync(dir);
    expect(all.filter((n) => n.endsWith(".tmp"))).toHaveLength(0);
  });
});

describe("writeJsonAtomicSync", () => {
  it("同步路径写入", () => {
    const path = join(dir, "z.json");
    writeJsonAtomicSync(path, { sync: true });
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    expect(parsed).toEqual({ sync: true });
  });

  it("覆盖现有文件", () => {
    const path = join(dir, "w.json");
    writeJsonAtomicSync(path, { v: 1 });
    writeJsonAtomicSync(path, { v: 2 });
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    expect(parsed).toEqual({ v: 2 });
  });

  it("失败时抛出", () => {
    const path = join(dir, "no-such-dir/w.json");
    expect(() => writeJsonAtomicSync(path, { a: 1 })).toThrow();
  });
});

describe("readJsonAsync", () => {
  it("解析合法 JSON", async () => {
    const path = join(dir, "r.json");
    writeJsonAtomicSync(path, { a: 1 });
    const r = await readJsonAsync<{ a: number }>(path, { a: 0 });
    expect(r).toEqual({ a: 1 });
  });

  it("文件不存在返回 fallback", async () => {
    const r = await readJsonAsync("missing.json", { fallback: true });
    expect(r).toEqual({ fallback: true });
  });

  it("JSON 损坏返回 fallback", async () => {
    const path = join(dir, "bad.json");
    writeJsonAtomicSync(path, { a: 1 });
    // 模拟损坏：直接 rm + 重写非法
    const { writeFileSync } = require("node:fs") as typeof import("node:fs");
    writeFileSync(path, "{ not json", "utf8");
    const r = await readJsonAsync<{ a: number }>(path, { a: -1 });
    expect(r).toEqual({ a: -1 });
  });
});

describe("fileExistsAsync", () => {
  it("存在返回 true", async () => {
    const path = join(dir, "e.json");
    writeJsonAtomicSync(path, { a: 1 });
    expect(await fileExistsAsync(path)).toBe(true);
  });

  it("不存在返回 false", async () => {
    expect(await fileExistsAsync(join(dir, "missing.json"))).toBe(false);
  });
});
