/** Real Electron/React button regressions with isolated storage and a deterministic offline provider. */
import { test, expect, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { launchApp } from "./helpers";
import { IPC_CHANNELS } from "../shared/ipc-channels";

const extension = `
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
export default function(pi) {
  pi.registerProvider("ui-fixture", {
    baseUrl: "https://offline.example", apiKey: "placeholder", api: "ui-fixture-api",
    models: [{ id: "fixture", name: "UI fixture", reasoning: false, input: ["text"], contextWindow: 200000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple(model, context, options) {
      const stream = createAssistantMessageEventStream();
      const user = context.messages.filter(m => m.role === "user").at(-1);
      const text = typeof user?.content === "string" ? user.content : user?.content?.filter(p => p.type === "text").map(p => p.text).join("") || "";
      const message = { role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id, stopReason: "stop", timestamp: Date.now(), usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 20, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      queueMicrotask(() => {
        stream.push({ type: "start", partial: message });
        if (text.includes("hold request")) {
          options?.signal?.addEventListener("abort", () => { message.stopReason = "aborted"; message.errorMessage = "Request was aborted."; stream.push({ type: "error", reason: "aborted", error: message }); stream.end(); }, { once: true });
        } else {
          message.content = [{ type: "text", text: "UI fixture reply" }];
          stream.push({ type: "text_end", contentIndex: 0, content: message.content[0].text, partial: message });
          stream.push({ type: "done", reason: "stop", message }); stream.end();
        }
      });
      return stream;
    }
  });
}`;

/** Create real project trees without touching the user's project or Pi profile. */
function makeProject(label: string) {
  const directory = mkdtempSync(join(tmpdir(), `x-agent-ui-${label}-`));
  mkdirSync(join(directory, ".pi", "extensions"), { recursive: true });
  writeFileSync(join(directory, ".pi", "extensions", "ui-fixture.ts"), extension);
  writeFileSync(join(directory, `${label}.txt`), `${label} project preview`);
  return directory;
}

/** Stub only the native folder chooser; actual IPC, host replacement and React state remain live. */
async function chooseProject(app: ElectronApplication, directory: string) {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, directory);
}

/** Start the real isolated application and load the offline provider before button interaction. */
async function fixture(project: string) {
  const result = await launchApp({ prepare: (home) => {
    const agentDir = join(home, ".pi", "agent");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ retry: { enabled: false } }));
  } });
  try {
    await result.main.emulateMedia({ reducedMotion: "reduce" });
    expect((await result.main.evaluate((cwd) => window.xAgent.workspace.open(cwd, "new"), project)).ok).toBe(true);
    expect(await result.main.evaluate(() => window.xAgent.session.setModel("ui-fixture", "fixture"))).toEqual({ ok: true });
    await result.main.evaluate(() => window.xAgent.prefs.set({ autoCompactPercent: 0 }));
    await expect(result.main.locator(".composer textarea")).toBeEnabled();
    return result;
  } catch (error) {
    await result.app.close();
    throw error;
  }
}

/** Drive the real send button and wait for the host's complete settlement boundary. */
async function send(main: Page, text: string) {
  await main.locator(".composer textarea").fill(text);
  await main.locator(".composer-send").click();
  await expect(main.locator(".bubble-user").filter({ hasText: text })).toBeVisible();
  if (!text.includes("hold request")) {
    await expect.poll(() => main.evaluate(async () => (await window.xAgent.workspace.getStatus()).status)).toBe("idle");
    await expect(main.locator(".bubble-text").filter({ hasText: "UI fixture reply" }).last()).toBeVisible();
  } else await expect.poll(() => main.evaluate(async () => (await window.xAgent.workspace.getStatus()).status)).toBe("streaming");
}

test("07 retract button and confirmation restore the original composer text", async () => {
  const project = makeProject("retract");
  const { app, main } = await fixture(project);
  try {
    const original = "original prompt for retract";
    await send(main, original);
    // Use the button's native keyboard activation so overlapping bubble chrome
    // cannot mask the state regression under test.
    const retract = main.locator(".bubble-user").getByRole("button", { name: "撤回", exact: true });
    await retract.focus();
    await retract.press("Enter");
    await main.getByRole("dialog", { name: "撤回此轮对话" }).getByRole("button", { name: "撤回", exact: true }).click();
    await expect(main.getByRole("dialog", { name: "撤回此轮对话" })).not.toBeVisible();
    await expect(main.locator(".composer textarea")).toHaveValue(original);
  } finally { await app.close(); rmSync(project, { recursive: true, force: true }); }
});

test("07 successful new code/design, sidebar resume and folder-open buttons clear stale drafts", async () => {
  const project = makeProject("session");
  const alternate = makeProject("alternate");
  const { app, main } = await fixture(project);
  try {
    await send(main, "saved history");
    const original = await main.evaluate(() => window.xAgent.workspace.getStatus());
    expect(original.sessionPath).toBeTruthy();
    await main.evaluate((path) => window.xAgent.workspace.renameSession(path, "history-to-resume"), original.sessionPath!);
    for (const type of ["code", "design"]) {
      await main.locator(".composer textarea").fill(`${type} stale draft`);
      await main.locator(`.topbar button[data-session-type="${type}"]`).click();
      await expect(main.locator(`.topbar button[data-session-type="${type}"]`)).toBeEnabled();
      await expect(main.locator(".composer textarea")).toHaveValue("");
    }
    await main.locator(".composer textarea").fill("resume stale draft");
    await main.locator(".session-card-main").filter({ hasText: "history-to-resume" }).click();
    await expect.poll(() => main.evaluate(async () => (await window.xAgent.workspace.getStatus()).sessionId)).toBe(original.sessionId);
    await expect(main.locator(".composer textarea")).toHaveValue("");
    await main.locator(".composer textarea").fill("open stale draft");
    await chooseProject(app, alternate);
    await main.getByRole("button", { name: "打开项目", exact: true }).click();
    await expect(main.locator(".cwd")).toHaveAttribute("title", alternate);
    await expect(main.locator(".composer textarea")).toHaveValue("");
  } finally { await app.close(); rmSync(project, { recursive: true, force: true }); rmSync(alternate, { recursive: true, force: true }); }
});

test("08 pending and canceled directory selection preserve live chat, session and queued steer", async () => {
  const project = makeProject("cancel");
  const { app, main } = await fixture(project);
  try {
    await send(main, "hold request");
    // Seed a real Pi steering queue; its UI intentionally blocks another pending bubble.
    await main.evaluate(() => window.xAgent.turn.prompt({ text: "queued request to preserve" }));
    await expect(main.locator(".queue-banner")).toContainText("queued request to preserve");
    const before = await main.evaluate(() => window.xAgent.workspace.getStatus());
    await app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = () => new Promise((resolve) => {
        (globalThis as unknown as { cancelDirectory: () => void }).cancelDirectory = () => resolve({ canceled: true, filePaths: [] });
      });
    });
    await main.getByRole("button", { name: "打开项目", exact: true }).click();
    await expect.poll(() => app.evaluate(() => typeof (globalThis as unknown as { cancelDirectory?: unknown }).cancelDirectory)).toBe("function");
    await expect(main.locator(".bubble-user").filter({ hasText: "hold request" })).toBeVisible();
    await expect(main.locator(".queue-banner")).toContainText("queued request to preserve");
    await app.evaluate(() => (globalThis as unknown as { cancelDirectory: () => void }).cancelDirectory());
    await expect(main.getByRole("button", { name: "打开项目", exact: true })).toBeEnabled();
    expect((await main.evaluate(() => window.xAgent.workspace.getStatus())).sessionId).toBe(before.sessionId);
    await expect(main.locator(".bubble-user").filter({ hasText: "hold request" })).toBeVisible();
    await expect(main.locator(".queue-banner")).toContainText("queued request to preserve");
  } finally { await main.evaluate(() => window.xAgent.turn.abort()).catch(() => {}); await app.close(); rmSync(project, { recursive: true, force: true }); }
});

test("08 failed project path retains the live host history and draft", async () => {
  const project = makeProject("failed");
  const { app, main } = await fixture(project);
  try {
    await send(main, "history before failed open");
    const before = await main.evaluate(() => window.xAgent.workspace.getStatus());
    await main.locator(".composer textarea").fill("draft before failed open");
    await chooseProject(app, join(project, "missing-project"));
    await main.getByRole("button", { name: "打开项目", exact: true }).click();
    await expect(main.getByRole("button", { name: "打开项目", exact: true })).toBeEnabled();
    expect((await main.evaluate(() => window.xAgent.workspace.getStatus())).sessionId).toBe(before.sessionId);
    await expect(main.locator(".bubble-user").filter({ hasText: "history before failed open" })).toBeVisible();
    await expect(main.locator(".composer textarea")).toHaveValue("draft before failed open");
  } finally { await app.close(); rmSync(project, { recursive: true, force: true }); }
});

test("08 rejected directory IPC preserves the session without escalating to app recovery", async () => {
  const project = makeProject("rejected");
  const { app, main } = await fixture(project);
  try {
    await send(main, "history before rejected open");
    const before = await main.evaluate(() => window.xAgent.workspace.getStatus());
    await main.locator(".composer textarea").fill("draft before rejected open");
    await app.evaluate(({ dialog }) => {
      (globalThis as unknown as { recoveryDialogs: number }).recoveryDialogs = 0;
      dialog.showMessageBox = () => {
        (globalThis as unknown as { recoveryDialogs: number }).recoveryDialogs++;
        return new Promise(() => {});
      };
      dialog.showOpenDialog = async () => { throw new Error("directory selection failed"); };
    });
    await main.getByRole("button", { name: "打开项目", exact: true }).click();
    await expect(main.getByRole("button", { name: "打开项目", exact: true })).toBeEnabled();
    expect((await main.evaluate(() => window.xAgent.workspace.getStatus())).sessionId).toBe(before.sessionId);
    await expect(main.locator(".bubble-user").filter({ hasText: "history before rejected open" })).toBeVisible();
    await expect(main.locator(".composer textarea")).toHaveValue("draft before rejected open");
    expect(await app.evaluate(() => (globalThis as unknown as { recoveryDialogs: number }).recoveryDialogs)).toBe(0);
  } finally { await app.close(); rmSync(project, { recursive: true, force: true }); }
});

test("09 an open Files tab follows project identity and ignores an older directory response", async () => {
  const first = makeProject("first");
  const second = makeProject("second");
  const { app, main } = await fixture(first);
  try {
    if (!(await main.locator(".right-panel").isVisible())) await main.getByRole("button", { name: "切换工具面板", exact: true }).click();
    await main.locator(".rp-nav").getByRole("button", { name: "文件", exact: true }).click();
    await main.locator(".rp-tree-row").filter({ hasText: "first.txt" }).click();
    await expect(main.locator(".rp-file-content")).toContainText("first project preview");
    // Capture an actual A-filesystem response, then defer only its delivery.
    await app.evaluate(({ ipcMain }, channel) => {
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => unknown> })._invokeHandlers;
      const original = handlers.get(channel)!;
      let once = true;
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, async (...args) => {
        const response = await original(...args);
        if (!once) return response;
        once = false;
        return new Promise((resolve) => { (globalThis as unknown as { releaseOldDirectory: () => void }).releaseOldDirectory = () => resolve(response); });
      });
    }, IPC_CHANNELS.listProjectDir);
    await main.locator(".rp-tree-row").filter({ hasText: "first.txt" }).click({ button: "right" });
    await expect(main.getByRole("menu")).toBeVisible();
    const refresh = main.locator(".rp-files-tree").getByRole("button", { name: "刷新", exact: true });
    await refresh.focus();
    await refresh.press("Enter");
    await expect.poll(() => app.evaluate(() => typeof (globalThis as unknown as { releaseOldDirectory?: unknown }).releaseOldDirectory)).toBe("function");
    await chooseProject(app, second);
    const open = main.getByRole("button", { name: "打开项目", exact: true });
    await open.focus();
    await open.press("Enter");
    await expect(main.locator(".cwd")).toHaveAttribute("title", second);
    await app.evaluate(() => (globalThis as unknown as { releaseOldDirectory: () => void }).releaseOldDirectory());
    await expect(main.locator(".rp-tree-row").filter({ hasText: "second.txt" })).toBeVisible();
    await expect(main.locator(".rp-tree-row").filter({ hasText: "first.txt" })).toHaveCount(0);
    await expect(main.locator(".rp-files-path")).toHaveText("未选择文件");
    await expect(main.locator(".rp-context-menu")).toHaveCount(0);
    await main.locator(".rp-tree-row").filter({ hasText: "second.txt" }).click({ button: "right" });
    await main.getByRole("menuitem", { name: "加入对话", exact: true }).click();
    await expect(main.locator(".composer textarea")).toHaveValue("@second.txt");
    await expect(main.locator(".rp-file-content")).toContainText("second project preview");
    // Keep the native OS shell closed, while checking the real IPC's chosen absolute target.
    await app.evaluate(({ shell }) => {
      shell.showItemInFolder = (path) => { (globalThis as unknown as { revealedPath: string }).revealedPath = path; };
    });
    await main.locator(".rp-files-preview").getByRole("button", { name: "在资源管理器中显示", exact: true }).click();
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { revealedPath?: string }).revealedPath)).toBe(join(second, "second.txt"));
  } finally { await app.close(); rmSync(first, { recursive: true, force: true }); rmSync(second, { recursive: true, force: true }); }
});
