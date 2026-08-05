/**
 * Vitest 套件 —— project-fs（listProjectDir / readProjectFile / revealProjectPath）。
 *
 * 由离线脚本 `scripts/test-cwd-sandbox.ts` 的 project-fs 部分迁移而来
 * （该脚本已在 0.4.0 测试收敛中退役），并补充 IGNORED_DIR_NAMES / 二进制 / 超大文件覆盖。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listProjectDir,
  readProjectFile,
  revealProjectPath,
  pathBasename,
} from "./project-fs";

describe("project-fs", () => {
  let cwd: string;

  beforeAll(() => {
    cwd = mkdtempSync(join(tmpdir(), "x-agent-project-fs-"));
    mkdirSync(join(cwd, "sub"), { recursive: true });
    mkdirSync(join(cwd, "node_modules"), { recursive: true });
    writeFileSync(join(cwd, "sub", "file.txt"), "hello from sub\n", "utf8");
    writeFileSync(join(cwd, "root.txt"), "hello from root\n", "utf8");
    writeFileSync(join(cwd, "node_modules", "pkg.js"), "x", "utf8");
    writeFileSync(join(cwd, "binary.bin"), Buffer.from([0, 1, 2, 3, 4]), "utf8");
  });

  afterAll(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  describe("listProjectDir", () => {
    it("列出根目录且目录优先排序", () => {
      const res = listProjectDir(cwd, "");
      expect(res.ok).toBe(true);
      const entries = res.entries ?? [];
      const sub = entries.find((e) => e.name === "sub");
      expect(sub?.isDir).toBe(true);
      expect(entries.some((e) => e.name === "root.txt")).toBe(true);
      // 目录排在文件前
      expect(entries[0]!.name).toBe("sub");
    });

    it("过滤 IGNORED_DIR_NAMES（node_modules 等）", () => {
      const res = listProjectDir(cwd, "");
      const names = (res.entries ?? []).map((e) => e.name);
      expect(names).not.toContain("node_modules");
    });

    it("列出子目录", () => {
      const res = listProjectDir(cwd, "sub");
      expect(res.ok).toBe(true);
      const names = (res.entries ?? []).map((e) => e.name);
      expect(names).toContain("file.txt");
    });

    it("拒绝 '../' 逃逸", () => {
      const res = listProjectDir(cwd, "../");
      expect(res.ok).toBe(false);
    });

    it("拒绝以文件作为目录列出", () => {
      const res = listProjectDir(cwd, "root.txt");
      expect(res.ok).toBe(false);
    });
  });

  describe("readProjectFile", () => {
    it("读取项目内文件", () => {
      const res = readProjectFile(cwd, "sub/file.txt");
      expect(res.ok).toBe(true);
      expect(res.content).toBe("hello from sub\n");
      expect(res.path).toBe("sub/file.txt");
    });

    it("拒绝绝对路径逃逸", () => {
      const outside = mkdtempSync(join(tmpdir(), "x-agent-outside-read-"));
      try {
        const outsideFile = join(outside, "secret.txt");
        writeFileSync(outsideFile, "nope", "utf8");
        const res = readProjectFile(cwd, outsideFile);
        expect(res.ok).toBe(false);
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });

    it("拒绝 '../' 逃逸", () => {
      const res = readProjectFile(cwd, "../nope.txt");
      expect(res.ok).toBe(false);
    });

    it("拒绝把根目录当文件读", () => {
      const res = readProjectFile(cwd, "");
      expect(res.ok).toBe(false);
    });

    it("识别二进制文件", () => {
      const res = readProjectFile(cwd, "binary.bin");
      expect(res.ok).toBe(false);
      expect(res.error).toContain("二进制");
    });
  });

  describe("revealProjectPath / pathBasename", () => {
    it("解析存在的路径并返回绝对路径", () => {
      const res = revealProjectPath(cwd, "sub/file.txt");
      expect(res.ok).toBe(true);
      expect(res.path).toBe(join(cwd, "sub", "file.txt"));
    });

    it("拒绝不存在的路径", () => {
      const res = revealProjectPath(cwd, "missing.txt");
      expect(res.ok).toBe(false);
    });

    it("pathBasename 归一化反斜杠", () => {
      expect(pathBasename("a\\b\\c.gd")).toBe("c.gd");
      expect(pathBasename("a/b/c.gd")).toBe("c.gd");
    });
  });
});
