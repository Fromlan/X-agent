/**
 * 校验 set_project_setting 的桌面端硬闸：
 * - 敏感前缀（autoload/* / input/* / debug/file_logging / debug/shapes / ...）拒绝
 * - value 类型收窄为 string / number / boolean / 嵌套简单对象 / 嵌套简单数组
 * - 嵌套层级 / 数组 / 对象大小有上限
 */
import { describe, expect, it } from "vitest";
import {
  FORBIDDEN_PROJECT_SETTING_EXACT_FOR_TEST,
  FORBIDDEN_PROJECT_SETTING_PREFIXES_FOR_TEST,
  validateProjectSettingPayload,
} from "./godot-project-setting";

describe("validateProjectSettingPayload", () => {
  it("通过合法 key + 标量 value", () => {
    const r = validateProjectSettingPayload({
      key: "application/config/name",
      value: "Hello",
    });
    expect(r).toEqual({ ok: true, key: "application/config/name", value: "Hello" });
  });

  it("通过合法 key + 数组", () => {
    const r = validateProjectSettingPayload({
      key: "application/config/version",
      value: ["1", 2, true],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual(["1", 2, true]);
  });

  it("通过合法 key + 嵌套对象", () => {
    const r = validateProjectSettingPayload({
      key: "display/window/size/viewport_size",
      value: { width: 1920, height: 1080 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ width: 1920, height: 1080 });
  });

  it("拒绝所有 FORBIDDEN 前缀", () => {
    for (const prefix of FORBIDDEN_PROJECT_SETTING_PREFIXES_FOR_TEST) {
      const key = prefix.endsWith("/")
        ? `${prefix}Foo`
        : `${prefix}/Foo`;
      const r = validateProjectSettingPayload({ key, value: "x" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/不允许通过 RPC 修改/);
    }
  });

  it("拒绝所有 FORBIDDEN 精确匹配", () => {
    for (const exact of FORBIDDEN_PROJECT_SETTING_EXACT_FOR_TEST) {
      const r = validateProjectSettingPayload({ key: exact, value: true });
      expect(r.ok).toBe(false);
    }
  });

  it("拒绝 input/* / autoload/* 的典型攻击载荷", () => {
    const attacks = [
      "autoload/Core:res://core.gd",
      "input/uadeadcode/ui_accept",
      "debug/file_logging/enable_file_logging",
      "debug/file_logging/enable_file_logging.pc",
      "project_settings_override/setup",
      "debug/shapes/collision/draw_collision_names",
      "debug/colors/skip_priority_lines",
      "network/tls/certificate_bundle_override",
    ];
    for (const key of attacks) {
      const r = validateProjectSettingPayload({ key, value: "x" });
      expect(r.ok, `expected reject for ${key}`).toBe(false);
    }
  });

  it("拒绝 editor_plugins/enabled（精确拒绝）", () => {
    const r = validateProjectSettingPayload({
      key: "editor_plugins/enabled",
      value: true,
    });
    expect(r.ok).toBe(false);
  });

  it("拒绝非字符串 key", () => {
    expect(validateProjectSettingPayload({ key: 123, value: 1 }).ok).toBe(false);
    expect(validateProjectSettingPayload({ key: "", value: 1 }).ok).toBe(false);
    expect(
      validateProjectSettingPayload({ key: "   ", value: 1 }).ok,
    ).toBe(false);
  });

  it("拒绝非法字符 key（含换行 / 注释符号）", () => {
    expect(
      validateProjectSettingPayload({
        key: "application/config/name\n[autoload]",
        value: "x",
      }).ok,
    ).toBe(false);
    expect(
      validateProjectSettingPayload({
        key: "application/config/name;evil",
        value: "x",
      }).ok,
    ).toBe(false);
  });

  it("拒绝 null / undefined / function", () => {
    expect(
      validateProjectSettingPayload({ key: "application/config/name", value: null })
        .ok,
    ).toBe(false);
    expect(
      validateProjectSettingPayload({
        key: "application/config/name",
        value: undefined,
      }).ok,
    ).toBe(false);
    expect(
      validateProjectSettingPayload({
        key: "application/config/name",
        value: () => "x",
      }).ok,
    ).toBe(false);
  });

  it("拒绝数组中嵌套对象 / 混合类型", () => {
    // 1 层嵌套（数组里套对象）允许
    const ok = validateProjectSettingPayload({
      key: "application/config/name",
      value: [1, { a: 2 }],
    });
    expect(ok.ok).toBe(true);
    // 再深一层（数组→对象→对象）超过 MAX_VALUE_DEPTH=4
    const tooDeep = validateProjectSettingPayload({
      key: "application/config/name",
      value: [{ a: { b: 1 } }],
    });
    expect(tooDeep.ok).toBe(false);
  });

  it("拒绝包含 null / 超深嵌套的对象 value", () => {
    expect(
      validateProjectSettingPayload({
        key: "application/config/name",
        value: { foo: null },
      }).ok,
    ).toBe(false);
    // 1 层嵌套对象允许
    const ok = validateProjectSettingPayload({
      key: "application/config/name",
      value: { foo: { bar: 1 } },
    });
    expect(ok.ok).toBe(true);
  });

  it("拒绝超过 5 层嵌套", () => {
    const deep = { a: { b: { c: 1 } } };
    expect(
      validateProjectSettingPayload({
        key: "application/config/name",
        value: deep,
      }).ok,
    ).toBe(false);
  });

  it("拒绝过大数组 / 对象", () => {
    const bigArray = Array.from({ length: 65 }, (_, i) => i);
    expect(
      validateProjectSettingPayload({
        key: "application/config/name",
        value: bigArray,
      }).ok,
    ).toBe(false);
    const bigObject: Record<string, number> = {};
    for (let i = 0; i < 65; i += 1) bigObject[`k${i}`] = i;
    expect(
      validateProjectSettingPayload({
        key: "application/config/name",
        value: bigObject,
      }).ok,
    ).toBe(false);
  });

  it("key 长度限制", () => {
    const long = "a".repeat(257);
    expect(
      validateProjectSettingPayload({ key: long, value: 1 }).ok,
    ).toBe(false);
  });
});
