/** Verify conversation-width guarantees and temporary geometry without a browser or persisted preference writes. */
import { describe, expect, it } from "vitest";
import { computeWorkspaceLayout, WORKSPACE_CHAT_MIN } from "./workspace-layout";

const preferred = { sidebarWidth: 260, rightPanelWidth: 360, sidebarCollapsed: false, rightPanelOpen: true };

describe("workspace column budgets", () => {
  it("uses a rail and bounded dock at the reported 979px window width", () => {
    expect(computeWorkspaceLayout({ ...preferred, width: 979 })).toMatchObject({
      sidebar: 56, right: 360, chat: 563, sidebarCollapsed: true, sidebarAutoCollapsed: true, rightPanelMode: "docked",
    });
  });

  it.each([1280, 1440, 1920])("restores the preferred full columns at %spx", (width) => {
    const layout = computeWorkspaceLayout({ ...preferred, width });
    expect(layout).toMatchObject({ sidebar: 260, right: 360, sidebarCollapsed: false, rightPanelMode: "docked" });
    expect(layout.chat).toBe(width - 620);
  });

  it.each([900, 760, 600])("uses an explicit drawer instead of squeezing or silently overlaying chat at %spx", (width) => {
    const layout = computeWorkspaceLayout({ ...preferred, width });
    expect(layout.rightPanelMode).toBe("drawer");
    expect(layout.sidebar).toBe(56);
    expect(layout.chat).toBe(width - 56);
    expect(layout.right).toBeLessThanOrEqual(width - 32);
  });

  it("clamps a wide panel to the available dock budget and restores its original preference later", () => {
    const input = { ...preferred, rightPanelWidth: 507, width: 979 };
    expect(computeWorkspaceLayout(input)).toMatchObject({ right: 363, chat: WORKSPACE_CHAT_MIN });
    expect(input.rightPanelWidth).toBe(507);
    expect(computeWorkspaceLayout({ ...input, width: 1440 })).toMatchObject({ right: 507, sidebar: 260, chat: 673 });
  });

  it("honors a user's collapsed sidebar preference even on a wide display", () => {
    expect(computeWorkspaceLayout({ ...preferred, width: 1440, sidebarCollapsed: true })).toMatchObject({ sidebar: 56, sidebarCollapsed: true, sidebarAutoCollapsed: false });
  });

  it("bases docking on the room left after the requested sidebar width", () => {
    expect(computeWorkspaceLayout({ ...preferred, width: 1040, sidebarWidth: 160 })).toMatchObject({ sidebar: 160, sidebarCollapsed: false, right: 320, chat: 560 });
    expect(computeWorkspaceLayout({ ...preferred, width: 1040, sidebarWidth: 269 })).toMatchObject({ sidebar: 56, sidebarCollapsed: true, right: 360, chat: 624 });
  });

  it("gives a closed panel no grid space and retains an accessible sidebar on small workspaces", () => {
    expect(computeWorkspaceLayout({ ...preferred, width: 979, rightPanelOpen: false })).toMatchObject({ sidebar: 260, right: 0, chat: 719, rightPanelMode: "closed" });
    expect(computeWorkspaceLayout({ ...preferred, width: 760, rightPanelOpen: false })).toMatchObject({ sidebar: 56, right: 0, chat: 704 });
  });

  it("keeps all displayed geometry finite and inside a temporarily zero-sized container", () => {
    expect(computeWorkspaceLayout({ ...preferred, width: 0 })).toMatchObject({ sidebar: 0, right: 0, chat: 0 });
    const layout = computeWorkspaceLayout({ ...preferred, width: 200 });
    expect(layout.right).toBe(168);
    expect(layout.chat).toBeGreaterThanOrEqual(0);
  });
});
