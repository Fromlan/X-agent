/** Check actual hit targets across Windows window sizes without calling a paid model or speech API. */
import { test, expect, type ElectronApplication, type Locator, type Page, type TestInfo } from "@playwright/test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchApp, toggleToolPanel } from "./helpers";

const SCREENSHOTS = fileURLToPath(new URL("../../../.scratch/ui-polish/", import.meta.url));

/** Seed only isolated storage and a local Godot project; selecting this fixture never sends a request. */
function prepareWorkspace(home: string): void {
  const agentDir = join(home, ".pi", "agent");
  mkdirSync(agentDir, { recursive: true });
  const provider = "responsive-fixture";
  writeFileSync(join(agentDir, "models.json"), JSON.stringify({ providers: { [provider]: {
    api: "openai-completions", baseUrl: "https://api.deepseek.com/v1", apiKey: "offline-invalid-key",
    models: [{ id: "deepseek-flash", name: "DeepSeek Flash · 响应式布局验证", reasoning: true,
      input: ["text", "image"], contextWindow: 100_000, maxTokens: 1000,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
  } } }));
  writeFileSync(join(agentDir, "auth.json"), JSON.stringify({ [provider]: { type: "api_key", key: "offline-invalid-key" } }));
  writeFileSync(join(agentDir, "x-agent.json"), JSON.stringify({ provider, model: "deepseek-flash",
    rightPanelOpen: false, rightPanelWidth: 360, sidebarWidth: 260, sidebarCollapsed: false, godotAutoConnect: false }));
  const project = join(home, "Moonfall-responsive");
  mkdirSync(project);
  writeFileSync(join(project, "project.godot"), 'config_version=5\n[application]\nconfig/name="Moonfall Responsive"\n');
  const sessions = join(agentDir, "x-agent", "sessions");
  mkdirSync(sessions, { recursive: true });
  const history = SessionManager.create(project, sessions);
  history.appendModelChange(provider, "deepseek-flash");
  history.appendMessage({ role: "user", content: "响应式布局历史记录", timestamp: Date.now() });
  history.appendSessionInfo("响应式布局历史");
}

/** Drive the native content size in DIP, including deliberately constrained Windows displays. */
async function resize(app: ElectronApplication, main: Page, width: number, height = 840): Promise<void> {
  const window = await app.browserWindow(main);
  await window.evaluate((window, size) => {
    window.webContents.setBackgroundThrottling(false);
    window.setMinimumSize(600, 420);
    window.setContentSize(size.width, size.height);
  }, { width, height });
  console.info(`Workspace resize requested: ${width}×${height}`);
  await expect.poll(() => main.evaluate(() => innerWidth)).toBe(width);
  await expect.poll(() => main.evaluate(() => innerHeight)).toBe(height);
}

/** Visibility alone misses overlapping panels; every sampled point must hit this control or its child. */
async function expectReachable(control: Locator): Promise<void> {
  await expect(control).toBeVisible();
  await expect(control).toBeInViewport({ ratio: 1 });
  await expect.poll(() => control.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    // Pill corners intentionally have no hit area; sample the central vertical line within the visible shape.
    const points = [0.25, 0.5, 0.75].map((ratio) => [rect.left + rect.width / 2, rect.top + rect.height * ratio]);
    return points.every(([x, y]) => node.contains(document.elementFromPoint(x!, y!)));
  }), { timeout: 5000 }).toBe(true).catch(async (error: unknown) => {
    const geometry = await control.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return { control: node.outerHTML.slice(0, 400), rect: rect.toJSON(), viewport: [innerWidth, innerHeight],
        samples: [0.25, 0.5, 0.75].map((ratio) => document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height * ratio)?.outerHTML.slice(0, 300)) };
    }).catch(() => null);
    console.info("Workspace inaccessible control:", JSON.stringify(geometry));
    await screenshot(control.page(), test.info(), `workspace-hit-target-failure-${Date.now()}.png`).catch(() => undefined);
    throw error;
  });
}

/** Preserve the exact same frame for Playwright diagnostics and the local visual review folder. */
async function screenshot(main: Page, info: TestInfo, name: string): Promise<void> {
  mkdirSync(SCREENSHOTS, { recursive: true });
  const output = info.outputPath(name);
  await main.screenshot({ path: output });
  copyFileSync(output, join(SCREENSHOTS, name));
}

/** Create the live session and leave the composer sendable without submitting any text. */
async function openWorkspace(main: Page, home: string): Promise<void> {
  console.info("Opening offline Godot workspace");
  expect(await main.evaluate((cwd) => window.xAgent.workspace.open(cwd, "new"), join(home, "Moonfall-responsive")))
    .toMatchObject({ ok: true });
  expect(await main.evaluate(() => window.xAgent.session.setModel("responsive-fixture", "deepseek-flash")))
    .toMatchObject({ ok: true });
  // The real new-session command clears model/resource notices and retains the chosen model.
  expect(await main.evaluate(() => window.xAgent.workspace.newSession("code"))).toMatchObject({ ok: true });
  await main.emulateMedia({ reducedMotion: "reduce" });
  expect(await main.evaluate(() => window.xAgent.session.setThinkingLevel("off"))).toMatchObject({ ok: true });
  await main.locator(".composer textarea").fill("检查关卡入口与角色交互，尚未发送");
  await expect(main.getByRole("button", { name: "语音输入", exact: true })).toBeVisible();
  console.info("Offline workspace and DeepSeek controls are ready");
}

/** Preserve assertion failures even if a native shutdown callback gets stuck on an unattended Windows desktop. */
async function closeApp(app: ElectronApplication, main: Page): Promise<void> {
  await main.keyboard.press("Escape").catch(() => undefined);
  await main.keyboard.press("Escape").catch(() => undefined);
  await main.locator(".composer textarea").fill("", { timeout: 2000 }).catch(() => undefined);
  await app.close().catch(() => undefined);
}

/** Check the quiet empty state remains inside the transcript and can scroll independently of the composer. */
async function expectEmptyStateUsable(main: Page): Promise<void> {
  const state = main.locator(".empty-state-starters");
  await expect(state).toBeVisible();
  const stream = main.locator(".message-stream");
  const box = await stream.boundingBox();
  const composer = await main.locator(".composer").boundingBox();
  expect(box).not.toBeNull();
  expect(composer).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(composer!.y + 1);
  const actions = state.getByRole("button");
  expect(await actions.count()).toBeGreaterThan(0);
  for (const action of await actions.all()) {
    await action.scrollIntoViewIfNeeded();
    await expectReachable(action);
  }
  expect(await main.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test("dock and modal panel layouts keep composer, navigation and voice options operable", async ({}, info) => {
  const { app, main, home } = await launchApp({ prepare: prepareWorkspace });
  try {
    await resize(app, main, 979);
    await openWorkspace(main, home);
    // Keep the first-run setup banner for one hit-target check before dismissing it for visual comparisons.
    await expectReachable(main.locator(".composer-send"));
    const dismiss = main.getByRole("button", { name: "不再提醒", exact: true });
    if (await dismiss.isVisible()) await dismiss.click();

    for (const width of [979, 1280, 900, 760, 1440]) {
      await test.step(`${width} DIP workspace`, async () => {
        if (await main.locator(".right-panel").isVisible()) await toggleToolPanel(main);
        await resize(app, main, width);
        await toggleToolPanel(main);
        const panel = main.locator(".right-panel");
        await expect(panel).toBeVisible();
        if (width === 979) await screenshot(main, info, "workspace-979-docked.png");
        const close = panel.getByRole("button", { name: "收起工具面板", exact: true });
        await expectReachable(close);
        if (width >= 979) {
          const chat = await main.locator(".chat-panel").boundingBox();
          const right = await panel.boundingBox();
          expect(chat!.x + chat!.width).toBeLessThanOrEqual(right!.x + 1);
          expect(chat!.width).toBeGreaterThanOrEqual(559);
          if (width === 979) {
            await expect(main.locator(".sidebar")).toHaveAttribute("data-collapsed", "true");
            expect((await main.locator(".sidebar").boundingBox())!.width).toBeLessThanOrEqual(64);
          }
          await expectReachable(main.locator(".composer-send"));
          await expectReachable(main.getByRole("button", { name: "模型", exact: true }));
        } else {
          await expect(main.getByRole("dialog", { name: "工具面板", exact: true })).toBeVisible();
          await screenshot(main, info, `workspace-${width}-drawer.png`);
          await main.keyboard.press("Escape");
          await expect(panel).toBeHidden();
          await expect.poll(() => main.evaluate(() => {
            const active = document.activeElement;
            return active instanceof HTMLElement && active !== document.body && active.getBoundingClientRect().width > 0;
          }), { timeout: 3000 }).toBe(true).catch(async (error: unknown) => {
            console.info("Workspace drawer focus restoration:", await main.evaluate(() => ({
              active: document.activeElement?.outerHTML.slice(0, 300),
              entry: (() => {
                const node = document.querySelector<HTMLElement>(".workspace-menu > summary");
                return node ? { html: node.outerHTML, rect: node.getBoundingClientRect().toJSON(),
                  inert: Boolean(node.closest("[inert]")), visibility: getComputedStyle(node).visibility } : null;
              })(),
              inert: Array.from(document.querySelectorAll("[inert]")).map((node) => node.className),
              modals: Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]')).map((node) => ({
                html: node.outerHTML.slice(0, 200), rect: node.getBoundingClientRect().toJSON(),
                inert: Boolean(node.closest("[inert]")), visibility: getComputedStyle(node).visibility,
              })),
            })));
            throw error;
          });
        }
        await expectReachable(main.locator(".composer-send"));
        const thinking = main.getByRole("button", { name: "Thinking", exact: true }).locator(".select-menu-value");
        await expect(thinking).toHaveText("思考：关闭");
        expect(await thinking.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
        const model = main.getByRole("button", { name: "模型", exact: true });
        await expectReachable(model);
        await model.click();
        await expect(main.getByRole("listbox")).toBeInViewport({ ratio: 1 });
        await main.keyboard.press("Escape");
        await expectReachable(main.getByRole("button", { name: "会话模式", exact: true }));
        await expectReachable(main.getByRole("button", { name: "语音输入", exact: true }));
        await expectReachable(main.locator(".sidebar").getByRole("button", { name: "设置", exact: true }));
        await expectReachable(main.locator(".sidebar").getByRole("button", { name: "新会话", exact: true }));
        await expectEmptyStateUsable(main);

        const options = main.getByRole("button", { name: "语音选项", exact: true });
        await expectReachable(options);
        await options.focus();
        await main.keyboard.press("Enter");
        const voice = main.getByRole("dialog", { name: "语音选项", exact: true });
        await expect(voice).toBeVisible();
        await expect(voice).toBeInViewport({ ratio: 1 });
        await expect(voice.getByRole("button", { name: "朗读最新回答", exact: true })).toBeDisabled();
        await expectReachable(voice.getByRole("button", { name: "关闭语音选项", exact: true }));
        if (width === 979) {
          await voice.getByRole("radio", { name: "Stella", exact: true }).focus();
          await main.keyboard.press("ArrowRight");
          await expect(voice.getByRole("radio", { name: "Tide", exact: true })).toBeChecked();
          await main.keyboard.press("ArrowLeft");
          await expect(voice.getByRole("radio", { name: "Stella", exact: true })).toBeChecked();
        }
        await screenshot(main, info, `workspace-${width}-voice.png`);
        await main.keyboard.press("Escape");
        await expect(voice).toBeHidden();
        await expect(options).toBeFocused();
        await options.click();
        await expect(voice).toBeVisible();
        // The popover intentionally floats over the textarea center; choose its exposed left edge as the outside target.
        await main.locator(".composer textarea").click({ position: { x: 8, y: 8 } });
        await expect(voice).toBeHidden();
        if (width === 760) {
          await main.locator(".sidebar").getByRole("button", { name: "展开会话栏", exact: true }).click();
          const sessions = main.getByRole("dialog", { name: "会话栏", exact: true });
          await expect(sessions).toBeVisible();
          await expectReachable(sessions.getByRole("button", { name: "关闭会话栏", exact: true }));
          await main.keyboard.press("Escape");
          await expect(sessions).toBeHidden();
          await expect(main.locator(".sidebar")).toHaveAttribute("data-collapsed", "true");
        }
        await screenshot(main, info, `workspace-${width}.png`);
      });
    }
  } finally { await closeApp(app, main); }
});

test("short windows preserve startup guidance and 979 DIP remains usable in light and contrast themes", async ({}, info) => {
  const { app, main, home } = await launchApp({ prepare: prepareWorkspace });
  try {
    await resize(app, main, 900, 600);
    await openWorkspace(main, home);
    await expectReachable(main.locator(".composer-send"));
    await expectReachable(main.getByRole("button", { name: "模型", exact: true }));
    await expectEmptyStateUsable(main);
    await screenshot(main, info, "workspace-900x600-startup.png");
    const dismiss = main.getByRole("button", { name: "不再提醒", exact: true });
    if (await dismiss.isVisible()) await dismiss.click();
    await resize(app, main, 979);
    await toggleToolPanel(main);
    await main.getByLabel("工作区选项", { exact: true }).click();
    await main.getByRole("button", { name: "切换主题", exact: true }).click();
    await expect(main.locator("body")).toHaveAttribute("data-theme", "default-light");
    await expectReachable(main.locator(".composer-send"));
    await expectReachable(main.getByRole("button", { name: "模型", exact: true }));
    await screenshot(main, info, "workspace-979-light.png");
    await main.locator(".sidebar-footer").getByRole("button", { name: "设置", exact: true }).click();
    await main.locator(".settings-nav").getByRole("button", { name: "通用", exact: true }).click();
    await main.getByRole("group", { name: "主题", exact: true }).getByRole("button", { name: "高对比", exact: true }).click();
    await main.getByRole("button", { name: "关闭设置", exact: true }).click();
    await expect(main.locator("body")).toHaveAttribute("data-theme", "contrast-light");
    await expectReachable(main.locator(".composer-send"));
    await expectReachable(main.getByRole("button", { name: "模型", exact: true }));
    expect(await main.locator(".composer-shell").evaluate((node) => getComputedStyle(node).boxShadow)).toBe("none");
    await screenshot(main, info, "workspace-979-contrast.png");
  } finally { await closeApp(app, main); }
});

test("panel resizing clamps to the viewport without overwriting the saved preferred width", async ({}, info) => {
  const { app, main, home } = await launchApp({ prepare: prepareWorkspace });
  try {
    await resize(app, main, 1440);
    await openWorkspace(main, home);
    const dismiss = main.getByRole("button", { name: "不再提醒", exact: true });
    if (await dismiss.isVisible()) await dismiss.click();
    await toggleToolPanel(main);
    const handle = main.getByRole("separator", { name: "调整工具面板宽度", exact: true });
    const box = (await handle.boundingBox())!;
    await main.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await main.mouse.down();
    await main.mouse.move(box.x - 500, box.y + box.height / 2, { steps: 12 });
    await main.mouse.up();
    await expect.poll(() => main.evaluate(async () => (await window.xAgent.prefs.get()).rightPanelWidth)).toBe(507);
    await resize(app, main, 1280);
    expect((await main.locator(".right-panel").boundingBox())!.width).toBeLessThanOrEqual(461);
    expect((await main.locator(".chat-panel").boundingBox())!.width).toBeGreaterThanOrEqual(559);
    expect(await main.evaluate(async () => (await window.xAgent.prefs.get()).rightPanelWidth)).toBe(507);
    await expectReachable(main.locator(".composer-send"));
    await screenshot(main, info, "workspace-1280-clamped-panel.png");
    await resize(app, main, 979);
    expect((await main.locator(".right-panel").boundingBox())!.width).toBeLessThanOrEqual(363);
    expect((await main.locator(".sidebar").boundingBox())!.width).toBeLessThanOrEqual(64);
    await expectReachable(main.locator(".composer-send"));
    expect(await main.evaluate(async () => (await window.xAgent.prefs.get()).rightPanelWidth)).toBe(507);
    await resize(app, main, 1440);
    await expect.poll(async () => (await main.locator(".right-panel").boundingBox())!.width).toBe(507);
    await resize(app, main, 979);
    const clamped = (await main.locator(".right-panel").boundingBox())!.width;
    const clampedHandle = main.getByRole("separator", { name: "调整工具面板宽度", exact: true });
    const clampedBox = (await clampedHandle.boundingBox())!;
    const point = { x: clampedBox.x + clampedBox.width / 2, y: clampedBox.y + clampedBox.height / 2 };
    await main.mouse.move(point.x, point.y);
    await main.mouse.down();
    await main.mouse.up();
    expect(await main.evaluate(async () => (await window.xAgent.prefs.get()).rightPanelWidth)).toBe(507);
    await main.mouse.down();
    await main.mouse.move(point.x + 1, point.y);
    await main.mouse.up();
    await expect.poll(async () => (await main.locator(".right-panel").boundingBox())!.width).toBeLessThan(clamped - 0.5);
    const adjusted = await main.evaluate(async () => (await window.xAgent.prefs.get()).rightPanelWidth);
    expect(adjusted).toBeLessThanOrEqual(Math.round(clamped));
    await resize(app, main, 760);
    const contextTab = main.locator(".right-panel").getByRole("button", { name: "上下文", exact: true });
    await contextTab.focus();
    await resize(app, main, 1440);
    await expect(contextTab).toBeFocused();
    await expect.poll(async () => (await main.locator(".right-panel").boundingBox())!.width).toBe(adjusted);
    await main.getByRole("separator", { name: "调整工具面板宽度", exact: true }).dblclick();
    await expect.poll(() => main.evaluate(async () => (await window.xAgent.prefs.get()).rightPanelWidth)).toBe(360);
    await expectReachable(main.locator(".composer-send"));
  } finally { await closeApp(app, main); }
});

test("sidebar drawers yield keyboard focus to settings and destructive confirmation dialogs", async () => {
  const { app, main, home } = await launchApp({ prepare: prepareWorkspace });
  try {
    await resize(app, main, 1280, 640);
    await openWorkspace(main, home);
    const dismiss = main.getByRole("button", { name: "不再提醒", exact: true });
    if (await dismiss.isVisible()) await dismiss.click();
    // A dock that becomes modal must let the already open settings dialog keep keyboard ownership.
    await toggleToolPanel(main);
    await main.keyboard.press("Control+,");
    const settings = main.getByRole("dialog", { name: "设置", exact: true });
    await expect(settings).toBeVisible();
    await main.keyboard.press("Tab");
    expect(await settings.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    await resize(app, main, 760, 640);
    expect(await settings.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    await main.keyboard.press("Escape");
    await expect(settings).toBeHidden();
    await expect(main.getByRole("dialog", { name: "工具面板", exact: true })).toBeVisible();
    await main.keyboard.press("Escape");
    await expect(main.locator(".right-panel")).toBeHidden();
    await main.locator(".sidebar").getByRole("button", { name: "展开会话栏", exact: true }).click();
    const sidebar = main.getByRole("dialog", { name: "会话栏", exact: true });
    await expect(sidebar).toBeVisible();
    await main.keyboard.press("Control+,");
    await expect(settings).toBeVisible();
    await main.keyboard.press("Tab");
    expect(await settings.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    await main.keyboard.press("Escape");
    await expect(settings).toBeHidden();
    await expect(sidebar).toBeVisible();
    await sidebar.getByRole("button", { name: "设置", exact: true }).click();
    await expect(settings).toBeVisible();
    await main.keyboard.press("Tab");
    expect(await settings.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    await main.getByRole("button", { name: "关闭设置", exact: true }).click();
    // The sidebar Settings command intentionally closes its own drawer before opening the replacement modal.
    await main.locator(".sidebar").getByRole("button", { name: "展开会话栏", exact: true }).click();
    await expect(sidebar).toBeVisible();
    await main.locator('.session-card-main[title="响应式布局历史"]').click({ button: "right" });
    await main.getByRole("menuitem", { name: "删除", exact: true }).click();
    const confirmation = main.getByRole("dialog", { name: "删除会话", exact: true });
    await expect(confirmation).toBeVisible();
    await expect(confirmation.getByRole("button", { name: "取消", exact: true })).toBeFocused();
    await main.keyboard.press("Tab");
    await expect(confirmation.getByRole("button", { name: "删除", exact: true })).toBeFocused();
    await main.keyboard.press("Escape");
    await expect(confirmation).toBeHidden();
    await expect(sidebar).toBeVisible();
    await main.keyboard.press("Escape");
    await expect(sidebar).toBeHidden();
    await expectReachable(main.locator(".composer-send"));
  } finally { await closeApp(app, main); }
});
