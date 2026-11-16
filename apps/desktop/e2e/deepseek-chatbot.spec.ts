/** Exercise model-gated voice controls and document chips through isolated, nonbillable Electron sessions. */
import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchApp } from "./helpers";
import { IPC_CHANNELS } from "../shared/ipc-channels";
import { encodePcmWav } from "../src/lib/pcm-recording";

/** Seed credentials and model metadata without making any model or voice requests. */
function prepareChatbot(home: string): void {
  const agentDir = join(home, ".pi", "agent");
  mkdirSync(agentDir, { recursive: true });
  const models = [
    { id: "deepseek-flash", name: "Official Flash fixture", reasoning: false, input: ["text"], contextWindow: 100_000, maxTokens: 1000 },
    { id: "other-model", name: "Other model fixture", reasoning: false, input: ["text"], contextWindow: 100_000, maxTokens: 1000 },
  ];
  writeFileSync(join(agentDir, "models.json"), JSON.stringify({ providers: {
    "chatbot-fixture": { api: "openai-completions", baseUrl: "https://api.deepseek.com/v1", apiKey: "offline-invalid-key", models },
    "proxy-fixture": { api: "openai-completions", baseUrl: "https://proxy.example/v1", apiKey: "offline-invalid-key", models: [models[0]] },
  } }));
  writeFileSync(join(agentDir, "auth.json"), JSON.stringify({
    "chatbot-fixture": { type: "api_key", key: "offline-invalid-key" },
    "proxy-fixture": { type: "api_key", key: "offline-invalid-key" },
  }));
  writeFileSync(join(agentDir, "x-agent.json"), JSON.stringify({ provider: "chatbot-fixture", model: "deepseek-flash", rightPanelOpen: false }));
  mkdirSync(join(home, "chatbot-project"));
}

/** Switch the real Pi session and wait for renderer capability projection. */
async function selectModel(main: Page, provider: string, id: string): Promise<void> {
  expect(await main.evaluate(async ({ provider, id }) => window.xAgent.session.setModel(provider, id), { provider, id }))
    .toMatchObject({ ok: true });
  await expect.poll(() => main.evaluate(async () => {
    const status = await window.xAgent.workspace.getStatus();
    return `${status.model?.provider}/${status.model?.id}`;
  })).toBe(`${provider}/${id}`);
}

test("only official deepseek-flash exposes voice, and switching models releases capture and rejects voice IPC", async () => {
  const { app, main, home } = await launchApp({ prepare: prepareChatbot });
  try {
    expect(await main.evaluate((cwd) => window.xAgent.workspace.open(cwd, "new"), join(home, "chatbot-project"))).toMatchObject({ ok: true });
    await selectModel(main, "chatbot-fixture", "deepseek-flash");
    await expect(main.getByRole("button", { name: "语音输入", exact: true })).toBeVisible();
    await main.getByRole("button", { name: "语音选项", exact: true }).click();
    await expect(main.getByRole("dialog", { name: "语音选项", exact: true }).getByRole("button", { name: "朗读最新回答", exact: true })).toBeDisabled();
    await main.keyboard.press("Escape");

    for (const [provider, id] of [["chatbot-fixture", "other-model"], ["proxy-fixture", "deepseek-flash"]]) {
      await selectModel(main, provider, id);
      await expect(main.getByRole("group", { name: "DeepSeek 语音", exact: true })).toHaveCount(0);
      // These are real sender-validated handlers; an unsupported model fails before auth or HTTP.
      const denied = await main.evaluate(async (wav) => ({
        tts: await window.xAgent.turn.deepseekSpeak({ requestId: "unsupported-tts", text: "离线边界检查" }),
        asr: await window.xAgent.turn.deepseekTranscribe({ requestId: "unsupported-asr", audio: new Uint8Array(wav) }),
      }), Array.from(encodePcmWav(new Float32Array(8))));
      expect(denied.tts).toEqual({ ok: false, error: "当前模型不支持 DeepSeek 语音功能" });
      expect(denied.asr).toEqual({ ok: false, error: "当前模型不支持 DeepSeek 语音功能" });
    }

    await selectModel(main, "chatbot-fixture", "deepseek-flash");
    await expect(main.getByRole("button", { name: "语音输入", exact: true })).toBeVisible();
    await main.evaluate(() => {
      const audit = { stopped: 0, closed: 0 };
      (window as unknown as { voiceCaptureAudit: typeof audit }).voiceCaptureAudit = audit;
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
        getUserMedia: async () => ({ getTracks: () => [{ stop: () => { audit.stopped++; } }] }),
      } });
      /** Supply a device-free audio graph; its lifetime still follows the real recording control. */
      window.AudioContext = class {
        sampleRate = 16_000;
        destination = {};
        resume = async () => undefined;
        close = async () => { audit.closed++; };
        createMediaStreamSource = () => ({ connect: () => undefined, disconnect: () => undefined });
        createScriptProcessor = () => ({ connect: () => undefined, disconnect: () => undefined, onaudioprocess: null });
        createGain = () => ({ gain: { value: 1 }, connect: () => undefined, disconnect: () => undefined });
      } as unknown as typeof AudioContext;
    });
    await main.getByRole("button", { name: "语音输入", exact: true }).click();
    await expect(main.getByRole("button", { name: "完成录音", exact: true })).toBeVisible();
    await selectModel(main, "chatbot-fixture", "other-model");
    await expect(main.getByRole("group", { name: "DeepSeek 语音", exact: true })).toHaveCount(0);
    await expect.poll(() => main.evaluate(() => (window as unknown as { voiceCaptureAudit: { stopped: number; closed: number } }).voiceCaptureAudit))
      .toEqual({ stopped: 1, closed: 1 });
    await expect(main.locator(".composer textarea")).toHaveValue("");
  } finally { await app.close(); }
});

test("rich and text documents retain visible chips and upload only after sending with a supported model", async ({}, testInfo) => {
  const { app, main, home } = await launchApp({ prepare: prepareChatbot });
  try {
    const window = await app.browserWindow(main);
    await window.evaluate((window) => { window.webContents.setBackgroundThrottling(false); window.setContentSize(1280, 840); });
    expect(await main.evaluate((cwd) => window.xAgent.workspace.open(cwd, "new"), join(home, "chatbot-project"))).toMatchObject({ ok: true });
    await selectModel(main, "chatbot-fixture", "deepseek-flash");
    await app.evaluate(({ ipcMain }, channels) => {
      const audit = { uploads: [] as { name: string; purpose: string }[], prompts: [] as string[] };
      (globalThis as unknown as { chatbotAttachmentAudit: typeof audit }).chatbotAttachmentAudit = audit;
      ipcMain.removeHandler(channels.upload);
      ipcMain.handle(channels.upload, (_event, input: { name: string; purpose: string }) => {
        audit.uploads.push({ name: input.name, purpose: input.purpose });
        return { ok: true, document: { id: `file-fixture-${audit.uploads.length}`, name: input.name, purpose: input.purpose, provider: "chatbot-fixture", authScope: "a".repeat(64) } };
      });
      ipcMain.removeHandler(channels.prompt);
      ipcMain.handle(channels.prompt, (_event, input: { text: string }) => { audit.prompts.push(input.text); return { ok: true }; });
    }, { upload: IPC_CHANNELS.deepseekUploadFile, prompt: IPC_CHANNELS.prompt });
    await main.locator('.composer input[type="file"]').setInputFiles([
      { name: "level-design.pdf", mimeType: "application/pdf", buffer: Buffer.from("offline PDF fixture") },
      { name: "balance.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from("offline worksheet fixture") },
    ]);
    const rich = main.locator(".composer-attachment-chip-file").filter({ hasText: "level-design.pdf" });
    const text = main.locator(".composer-attachment-chip-file").filter({ hasText: "balance.xlsx" });
    await expect(rich).toContainText("DeepSeek");
    await expect(rich).toHaveAttribute("title", /图文解析/);
    await expect(text).toContainText("DeepSeek");
    await expect(text).toHaveAttribute("title", /转换为文字/);
    expect(await app.evaluate(() => (globalThis as unknown as { chatbotAttachmentAudit: { uploads: unknown[] } }).chatbotAttachmentAudit.uploads)).toEqual([]);
    const dismissSetup = main.getByRole("button", { name: "不再提醒", exact: true });
    if (await dismissSetup.isVisible()) await dismissSetup.click();
    await expect(main.getByRole("button", { name: "语音输入", exact: true })).toBeInViewport();
    await expect(main.locator(".composer-send")).toBeInViewport();
    await main.screenshot({ path: testInfo.outputPath("deepseek-chatbot-attachments.png") });
    await window.evaluate((window) => window.setContentSize(900, 700));
    await expect(main.getByRole("button", { name: "语音输入", exact: true })).toBeInViewport();
    await expect(main.locator(".composer-send")).toBeInViewport();
    await main.screenshot({ path: testInfo.outputPath("deepseek-chatbot-narrow.png") });
    await window.evaluate((window) => window.setContentSize(1280, 840));

    await selectModel(main, "chatbot-fixture", "other-model");
    await main.locator(".composer textarea").fill("检查关卡文档与数值");
    await main.locator(".composer-send").click();
    await expect(main.getByText("这些文档已选择 DeepSeek 解析，请切回官方 deepseek-flash 后发送，或移除后重新添加。", { exact: true })).toBeVisible();
    expect(await app.evaluate(() => (globalThis as unknown as { chatbotAttachmentAudit: { uploads: unknown[]; prompts: string[] } }).chatbotAttachmentAudit))
      .toEqual({ uploads: [], prompts: [] });
    await expect(rich).toBeVisible();
    await expect(text).toBeVisible();

    await selectModel(main, "chatbot-fixture", "deepseek-flash");
    await expect(main.getByRole("button", { name: "语音输入", exact: true })).toBeVisible();
    await main.locator(".composer-send").click();
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { chatbotAttachmentAudit: { uploads: { name: string; purpose: string }[] } }).chatbotAttachmentAudit.uploads))
      .toEqual([{ name: "level-design.pdf", purpose: "rich_layout_recognition" }, { name: "balance.xlsx", purpose: "user_data" }]);
    const prompts = await app.evaluate(() => (globalThis as unknown as { chatbotAttachmentAudit: { prompts: string[] } }).chatbotAttachmentAudit.prompts);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("<deepseek_document>");
    expect(prompts[0]).toContain("file-fixture-1");
    expect(prompts[0]).toContain("file-fixture-2");
    await expect(main.locator(".composer-attachment-chip-file")).toHaveCount(0);
  } finally { await app.close(); }
});
