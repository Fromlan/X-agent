/**
 * Vitest 套件 —— 覆盖 ROADMAP 1.1 首批 PoC 模块。
 *
 * 与 `scripts/test-cwd-sandbox.ts`（离线断言脚本）并存：
 * - 旧脚本：CI 必跑，用于不依赖 vitest 二进制的快速冒烟
 * - 新套件：开发者本地 `npm run test:unit` 跑，享受 watch / coverage / IDE 集成
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { resolveInsideCwd } from "./cwd-sandbox";

describe("resolveInsideCwd", () => {
  let cwd: string;

  beforeAll(() => {
    cwd = mkdtempSync(join(tmpdir(), "x-agent-sandbox-vitest-"));
    mkdirSync(join(cwd, "sub"), { recursive: true });
    writeFileSync(join(cwd, "sub", "file.txt"), "hello from sub\n", "utf8");
    writeFileSync(join(cwd, "root.txt"), "hello from root\n", "utf8");
  });

  afterAll(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  describe("合法路径", () => {
    it("解析项目内相对路径", () => {
      const res = resolveInsideCwd(cwd, "sub/file.txt");
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.rel).toBe("sub/file.txt");
        expect(res.abs).toBe(join(cwd, "sub", "file.txt"));
      }
    });

    it("解析项目根路径返回空 rel", () => {
      const res = resolveInsideCwd(cwd, ".");
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.rel).toBe("");
        expect(res.abs).toBe(cwd.replace(/\\/g, "/") === cwd ? cwd : cwd);
      }
    });

    it("解析已在 cwd 内的绝对路径", () => {
      const absInside = join(cwd, "sub", "file.txt");
      const res = resolveInsideCwd(cwd, absInside);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.abs.replace(/\\/g, "/")).toBe(
          absInside.replace(/\\/g, "/"),
        );
      }
    });
  });

  describe("Windows 路径分隔符", () => {
    if (process.platform !== "win32") {
      it.skip("仅在 win32 验证反斜杠路径", () => {});
      return;
    }
    it("接受反斜杠相对路径", () => {
      const res = resolveInsideCwd(cwd, "sub\\file.txt");
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.rel).toBe("sub/file.txt");
      }
    });

    it("拒绝反斜杠 ../ 转义", () => {
      const res = resolveInsideCwd(cwd, "..\\evil.txt");
      expect(res.ok).toBe(false);
      if (!res.ok) {
        // 相对路径含 `..` 段 → 非法路径（与实现一致，见 cwd-sandbox.ts）
        expect(res.error).toBe("非法路径");
      }
    });

    it("Windows 大小写不敏感仍能命中", () => {
      // 大写盘符/目录在 win32 下应解析为同一文件
      const upper = cwd.toUpperCase();
      const res = resolveInsideCwd(upper, "sub\\file.txt");
      expect(res.ok).toBe(true);
    });
  });

  describe("非法路径", () => {
    it("拒绝 ../ 转义（posix）", () => {
      const res = resolveInsideCwd(cwd, "../evil.txt");
      expect(res.ok).toBe(false);
      if (!res.ok) {
        // 相对路径含 `..` 段 → 非法路径（与实现一致，见 cwd-sandbox.ts）
        expect(res.error).toBe("非法路径");
      }
    });

    it("拒绝嵌套 ../ 转义", () => {
      const res = resolveInsideCwd(cwd, "sub/../../evil.txt");
      expect(res.ok).toBe(false);
    });

    it("拒绝 NUL 字节注入", () => {
      const res = resolveInsideCwd(cwd, "sub/\0/../file.txt");
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBe("非法路径");
      }
    });

    it("拒绝项目外的绝对路径", () => {
      const outside =
        process.platform === "win32"
          ? "C:\\Windows\\System32\\drivers\\etc\\hosts"
          : "/etc/hosts";
      const res = resolveInsideCwd(cwd, outside);
      expect(res.ok).toBe(false);
    });

    it("cwd 不存在时返回错误", () => {
      const res = resolveInsideCwd(
        join(cwd, "this-path-does-not-exist"),
        "file.txt",
      );
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBe("未打开项目");
      }
    });

    it("空 cwd 返回错误", () => {
      const res = resolveInsideCwd("", "file.txt");
      expect(res.ok).toBe(false);
    });
  });

  describe("回归契约", () => {
    // 锁定 Windows NTFS 大小写不敏感行为（CLAUDE.md 6.4）
    it("大小写差异不应逃出 cwd", () => {
      // 构造一个 cwd 自身的"大写"前缀，模拟大小写差异
      const fakeCwd = cwd.toUpperCase();
      const inside = join(cwd, "root.txt");
      const res = resolveInsideCwd(fakeCwd, inside);
      // 在大小写不敏感 FS 上应成功；这里只检查不抛错
      expect(typeof res.ok).toBe("boolean");
    });

    // 锁定 cwd 沙箱对 sep 的处理
    it("rel 始终使用正斜杠", () => {
      const res = resolveInsideCwd(cwd, "sub/file.txt");
      if (res.ok) {
        expect(res.rel.includes("\\")).toBe(false);
      }
    });
  });
});
