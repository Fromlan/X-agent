/**
 * CompositeRestoreSource 调度契约：优先级、降级、警告合并与 bash/Godot 增强。
 */
import { describe, expect, it, vi } from "vitest";
import {
  CompositeRestoreSource,
  type RestoreAttempt,
  type RestorePreview,
  type RestoreSegmentScan,
  type RestoreSource,
} from "./restore-source";

const scan: RestoreSegmentScan = {
  mutationPaths: ["a.txt"],
  userEntryIds: ["u1"],
  hasBash: false,
  hasGodot: false,
};

function makeSource(
  kind: "shadow" | "baseline",
  preview: RestorePreview,
  restore: RestoreAttempt,
): RestoreSource {
  return {
    kind,
    label: kind === "shadow" ? "Shadow 检查点" : "write/edit 基线",
    fallbackWarning:
      kind === "shadow" ? "Shadow 检查点还原失败，已降级为 write/edit 基线。" : "x",
    preview: vi.fn(async () => preview),
    restore: vi.fn(async () => restore),
  };
}

const sm = {} as never;

describe("CompositeRestoreSource.preview", () => {
  it("shadow 可处理时采用 shadow 结果", async () => {
    const shadow = makeSource("shadow", {
      mode: "shadow",
      restorablePaths: ["a.txt"],
      unrestorablePaths: [],
      hasBash: true,
      hasGodot: false,
      warnings: ["w-shadow"],
    }, { used: "none" });
    const baseline = makeSource("baseline", {
      mode: "baseline",
      restorablePaths: [],
      unrestorablePaths: [],
      hasBash: true,
      hasGodot: false,
      warnings: ["w-baseline"],
    }, { used: "none" });
    const composite = new CompositeRestoreSource([shadow, baseline]);

    const result = await composite.preview(sm, "u1", scan);
    expect(result.mode).toBe("shadow");
    expect(result.restorablePaths).toEqual(["a.txt"]);
    expect(baseline.preview).not.toHaveBeenCalled();
  });

  it("shadow 说 baseline 时跳过并合并警告到 baseline 结果", async () => {
    const shadow = makeSource("shadow", {
      mode: "baseline",
      restorablePaths: [],
      unrestorablePaths: [],
      hasBash: false,
      hasGodot: false,
      warnings: ["未安装 Git"],
    }, { used: "none" });
    const baseline = makeSource("baseline", {
      mode: "baseline",
      restorablePaths: ["a.txt"],
      unrestorablePaths: [],
      hasBash: false,
      hasGodot: false,
      warnings: ["1 个文件缺少基线"],
    }, { used: "none" });
    const composite = new CompositeRestoreSource([shadow, baseline]);

    const result = await composite.preview(sm, "u1", scan);
    expect(result.mode).toBe("baseline");
    expect(result.restorablePaths).toEqual(["a.txt"]);
    expect(result.warnings).toEqual(["未安装 Git", "1 个文件缺少基线"]);
  });

  it("全 none 时返回 none 且携带已收集警告", async () => {
    const shadow = makeSource("shadow", {
      mode: "none",
      restorablePaths: [],
      unrestorablePaths: [],
      hasBash: false,
      hasGodot: false,
      warnings: ["w"],
    }, { used: "none" });
    const composite = new CompositeRestoreSource([shadow]);
    const result = await composite.preview(sm, "u1", scan);
    expect(result.mode).toBe("none");
    expect(result.warnings).toEqual(["w"]);
  });
});

describe("CompositeRestoreSource.restore", () => {
  it("shadow 成功时采用 shadow report 并增强 bash/godot 警告", async () => {
    const shadow = makeSource("shadow", { mode: "shadow", restorablePaths: [], unrestorablePaths: [], hasBash: true, hasGodot: true, warnings: [] }, {
      used: "shadow",
      report: { restored: ["a.txt"], deleted: [], skipped: [], warnings: [] },
    });
    const baseline = makeSource("baseline", { mode: "baseline", restorablePaths: [], unrestorablePaths: [], hasBash: true, hasGodot: true, warnings: [] }, { used: "none" });
    const composite = new CompositeRestoreSource([shadow, baseline]);

    const result = await composite.restore(sm, "u1", {
      ...scan,
      hasBash: true,
      hasGodot: true,
    });
    expect(result.used).toBe("shadow");
    expect(baseline.restore).not.toHaveBeenCalled();
    expect(result.report?.skipped).toContainEqual({ reason: "godot" });
    expect(result.report?.warnings.some((w) => w.includes("bash"))).toBe(true);
  });

  it("shadow 失败降级 baseline 并前置降级警告", async () => {
    const shadow = makeSource("shadow", { mode: "none", restorablePaths: [], unrestorablePaths: [], hasBash: false, hasGodot: false, warnings: [] }, {
      used: "none",
      report: { restored: [], deleted: [], skipped: [], warnings: ["shadow 内部错误"] },
    });
    const baseline = makeSource("baseline", { mode: "baseline", restorablePaths: [], unrestorablePaths: [], hasBash: false, hasGodot: false, warnings: [] }, {
      used: "baseline",
      report: { restored: ["a.txt"], deleted: [], skipped: [], warnings: [] },
    });
    const composite = new CompositeRestoreSource([shadow, baseline]);

    const result = await composite.restore(sm, "u1", scan);
    expect(result.used).toBe("baseline");
    expect(result.report?.restored).toEqual(["a.txt"]);
    expect(result.report?.warnings).toEqual([
      "Shadow 检查点还原失败，已降级为 write/edit 基线。",
      "shadow 内部错误",
    ]);
  });

  it("shadow 失败且无 report 时直接降级", async () => {
    const shadow = makeSource("shadow", { mode: "none", restorablePaths: [], unrestorablePaths: [], hasBash: false, hasGodot: false, warnings: [] }, { used: "none" });
    const baseline = makeSource("baseline", { mode: "baseline", restorablePaths: [], unrestorablePaths: [], hasBash: true, hasGodot: false, warnings: [] }, {
      used: "baseline",
      report: { restored: [], deleted: [], skipped: [], warnings: [] },
    });
    const composite = new CompositeRestoreSource([shadow, baseline]);

    const result = await composite.restore(sm, "u1", { ...scan, hasBash: true });
    expect(result.used).toBe("baseline");
    expect(result.report?.skipped).toContainEqual({ reason: "bash_unknown" });
  });
});
