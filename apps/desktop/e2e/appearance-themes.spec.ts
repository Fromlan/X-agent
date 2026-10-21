/** Verify theme selection, readable palettes, keyboard access and persistence in the real renderer. */
import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { THEME_IDS, THEME_LABELS } from "../shared/ipc/prefs";
import { launchApp } from "./helpers";

test("theme cards apply readable dark and light palettes and survive reload", async ({}, testInfo) => {
  const { app, main, home } = await launchApp();
  try {
    await main.emulateMedia({ reducedMotion: "reduce" });
    await main.locator(".sidebar-footer").getByRole("button", { name: "设置", exact: true }).click();
    await main.locator(".settings-nav").getByRole("button", { name: "通用", exact: true }).click();
    const cards = main.getByRole("group", { name: "主题", exact: true });
    await expect(cards.getByRole("button")).toHaveCount(THEME_IDS.length);
    for (const mode of ["dark", "light"] as const) {
      if (mode === "light") {
        await main.getByRole("button", { name: "外观模式", exact: true }).click();
        await main.getByRole("option", { name: "浅色", exact: true }).click();
      }
      for (const id of THEME_IDS) {
        const card = cards.getByRole("button", { name: THEME_LABELS[id], exact: true });
        await card.click();
        await expect(card).toHaveAttribute("aria-pressed", "true");
        await expect(main.locator("body")).toHaveAttribute("data-theme", `${id}-${mode}`);
        const ratios = await main.evaluate(() => {
          const probe = document.createElement("span");
          // Reduced-motion CSS still has a short transition; sample final colors within the same frame.
          probe.style.setProperty("transition", "none", "important");
          document.body.append(probe);
          /** Resolve aliases in the active theme rather than reading unresolved CSS variable strings. */
          function luminance(token: string) {
            probe.style.color = `var(${token})`;
            const rgb = getComputedStyle(probe).color.match(/[\d.]+/g)!.slice(0, 3).map(Number);
            const linear = rgb.map((v) => v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
            return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
          }
          /** WCAG text contrast is independent of which side is lighter. */
          function ratio(text: string, background: string) {
            const a = luminance(text), b = luminance(background);
            return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
          }
          const result = {
            primary: ratio("--text-primary", "--bg-main"),
            secondary: ratio("--text-secondary", "--bg-sidebar"),
            selected: ratio("--text-primary", "--bg-list-selected"),
            placeholder: ratio("--text-placeholder", "--bg-card-elev"),
            button: ratio("--btn-text", "--btn-bg"),
          };
          probe.remove();
          return result;
        });
        for (const [role, contrast] of Object.entries(ratios)) {
          expect(contrast, `${id}-${mode} ${role}`).toBeGreaterThanOrEqual(4.5);
        }
        // Preview aliases must resolve locally, even when their mode differs from the active family.
        const preview = card.locator(".theme-preview");
        const previewColor = await preview.evaluate((node) => getComputedStyle(node).backgroundColor);
        const canvasColor = await main.locator(".chat-panel").evaluate((node) => getComputedStyle(node).backgroundColor);
        expect(previewColor).toBe(canvasColor);
      }
    }
    // Exercise keyboard activation and a new ID through both the IPC schema and disk persistence.
    const sage = cards.getByRole("button", { name: "松绿", exact: true });
    await sage.focus();
    await main.keyboard.press("Enter");
    await expect(sage).toHaveAttribute("aria-pressed", "true");
    await main.screenshot({ path: testInfo.outputPath("theme-picker.png") });
    expect(JSON.parse(readFileSync(join(home, ".pi", "agent", "x-agent.json"), "utf8")))
      .toMatchObject({ themeId: "sage", colorMode: "light" });
    await main.reload();
    await expect(main.locator("body")).toHaveAttribute("data-theme", "sage-light");
    const nativeWindow = await app.browserWindow(main);
    await nativeWindow.evaluate((window) => window.setContentSize(900, 600));
    await main.locator(".sidebar-footer").getByRole("button", { name: "设置", exact: true }).click();
    await main.locator(".settings-nav").getByRole("button", { name: "通用", exact: true }).click();
    await expect(main.getByRole("button", { name: "关闭设置", exact: true })).toBeInViewport();
    await main.getByRole("group", { name: "主题", exact: true }).getByRole("button", { name: "暖砂", exact: true }).click();
    await expect(main.locator("body")).toHaveAttribute("data-theme", "paper-light");
    await main.getByRole("button", { name: "关闭设置", exact: true }).click();
    await expect(main.locator(".composer-send")).toBeInViewport();
    await main.locator(".sidebar-footer").getByRole("button", { name: "设置", exact: true }).click();
    await main.locator(".settings-nav").getByRole("button", { name: "通用", exact: true }).click();
    const preferences = join(home, ".pi", "agent", "x-agent.json");
    writeFileSync(preferences, "{corrupt");
    await main.getByRole("group", { name: "主题", exact: true }).getByRole("button", { name: "雾蓝", exact: true }).click();
    await expect(main.getByRole("status").filter({ hasText: "主题保存失败，请重试。" })).toBeInViewport();
    await expect(main.getByRole("button", { name: "暖砂", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(main.locator("body")).toHaveAttribute("data-theme", "paper-light");
    expect(readFileSync(preferences, "utf8")).toBe("{corrupt");
  } finally { await app.close(); }
});
