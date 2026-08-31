/**
 * Vitest 单元测试 — `/init` 扩展工厂.
 * Mock Pi `ExtensionAPI`, 验证 registerCommand 调用形态与 handler 行为.
 */
import { describe, expect, it, vi } from "vitest";
import { createInitCommandExtension } from "./init-command";

type CapturedHandler = (
  args: string,
  ctx: { cwd: string; ui: { notify: (...a: unknown[]) => void } },
) => Promise<void> | void;

interface FakePi {
  registerCommand: ReturnType<typeof vi.fn>;
  sendUserMessage: ReturnType<typeof vi.fn>;
}

function makeFakePi(): {
  pi: FakePi;
  getRegistered: () =>
    | { name: string; description: string; handler: CapturedHandler }
    | undefined;
  getSentMessages: () => unknown[];
} {
  const pi: FakePi = {
    registerCommand: vi.fn(),
    sendUserMessage: vi.fn(),
  };
  return {
    pi,
    getRegistered: () => {
      const calls = pi.registerCommand.mock.calls;
      if (calls.length === 0) return undefined;
      const [name, opts] = calls[0] as [string, { description: string; handler: CapturedHandler }];
      return { name, description: opts.description, handler: opts.handler };
    },
    getSentMessages: () => pi.sendUserMessage.mock.calls.map((c) => c[0]),
  };
}

describe("createInitCommandExtension", () => {
  it("返回 InlineExtension (function)", () => {
    const ext = createInitCommandExtension();
    expect(typeof ext).toBe("function");
  });

  it("调用扩展工厂后, pi.registerCommand 收到 ('init', { description, handler })", () => {
    const { pi, getRegistered } = makeFakePi();
    const ext = createInitCommandExtension();
    ext(pi as never);
    expect(pi.registerCommand).toHaveBeenCalledTimes(1);
    const reg = getRegistered();
    expect(reg?.name).toBe("init");
    expect(typeof reg?.description).toBe("string");
    expect((reg?.description ?? "").length).toBeGreaterThan(0);
    expect((reg?.description ?? "").length).toBeLessThanOrEqual(240);
    expect(typeof reg?.handler).toBe("function");
  });

  it("description 包含中文（与 Mavis init skill 风格一致）", () => {
    const { pi, getRegistered } = makeFakePi();
    const ext = createInitCommandExtension();
    ext(pi as never);
    const desc = getRegistered()?.description ?? "";
    // 中文字符在 Unicode 4E00-9FFF 范围
    expect(/[\u4e00-\u9fff]/.test(desc)).toBe(true);
  });

  it("调 handler: pi.sendUserMessage 被调用一次, 消息含 cwd / 日期 / 关键流程词", async () => {
    const { pi, getSentMessages } = makeFakePi();
    const ext = createInitCommandExtension();
    ext(pi as never);
    const captured = (pi.registerCommand.mock.calls[0] as [
      string,
      { description: string; handler: CapturedHandler },
    ])[1].handler;
    const ctx = { cwd: "D:\\tmp\\demo", ui: { notify: () => undefined } };
    await captured("", ctx);
    expect(pi.sendUserMessage).toHaveBeenCalledTimes(1);
    const messages = getSentMessages() as string[];
    expect(messages.length).toBe(1);
    const msg = messages[0] ?? "";
    // <cmd> wrapper: chat transcript 会把它当成 chip 渲染
    expect(msg.startsWith('<cmd name="init">')).toBe(true);
    expect(msg.endsWith("</cmd>")).toBe(true);
    // 拼装内容自检
    expect(msg).toContain("D:\\tmp\\demo");
    expect(msg).toContain("/init");
    // 日期 YYYY-MM-DD
    expect(msg).toMatch(/\d{4}-\d{2}-\d{2}/);
    // 流程关键短语（pre-write check / AGENTS.md / skip / overwrite）
    expect(msg).toContain("AGENTS.md");
    expect(msg.toLowerCase()).toContain("pre-write check");
    expect(msg).toContain("Skip");
    expect(msg).toContain("Overwrite");
  });

  it("消息以 init body 结尾（build-time ?raw 导入生效）", async () => {
    const { pi } = makeFakePi();
    const ext = createInitCommandExtension();
    ext(pi as never);
    const captured = (pi.registerCommand.mock.calls[0] as [
      string,
      { description: string; handler: CapturedHandler },
    ])[1].handler;
    const ctx = { cwd: "/tmp/x", ui: { notify: () => undefined } };
    await captured("", ctx);
    const msg = (pi.sendUserMessage.mock.calls[0] as [string])[0];
    // body 关键标题（来自 init/SKILL.md）—— 在 <cmd> 包裹内仍可见
    expect(msg).toContain("Bootstrap AGENTS.md for the current project");
    // body 段落锚点
    expect(msg).toContain("Pre-write check");
    expect(msg).toContain("Multi-repo exception");
  });
});

describe("wrapCommandSlashAsBlock", () => {
  it("包成 <cmd name=...>...</cmd> 格式", async () => {
    const { wrapCommandSlashAsBlock } = await import("./init-command");
    const wrapped = wrapCommandSlashAsBlock("init", "body text");
    expect(wrapped).toBe('<cmd name="init">\nbody text\n</cmd>');
  });

  it("name 包含双引号时不做转义（由调用方保证 name 是合法标识符）", async () => {
    const { wrapCommandSlashAsBlock } = await import("./init-command");
    // 现状: 不转义, 因为 name 必须是合法的小写连字符标识符（与 plugin name 一致）。
    // 双引号 / 尖括号出现在 name 里属于调用方 bug, 由 lint / registerCommand 校验挡住。
    const wrapped = wrapCommandSlashAsBlock('a"b', "x");
    expect(wrapped).toContain('<cmd name="a"b">');
  });

  it("content 末尾的换行被 trimEnd, 避免 chip body 多空行", async () => {
    const { wrapCommandSlashAsBlock } = await import("./init-command");
    const wrapped = wrapCommandSlashAsBlock("init", "line1\nline2\n\n\n");
    expect(wrapped).toBe('<cmd name="init">\nline1\nline2\n</cmd>');
  });
});
