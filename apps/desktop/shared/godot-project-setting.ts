/**
 * 校验 `godot_set_project_setting` 的 RPC 参数 —— 防止 Agent 一次工具调用
 * 在 `project.godot` 注入高危配置（autoload 自动加载脚本、input 重映射键位、
 * 远程调试与文件日志开关、project.godot override 等）。
 *
 * 策略：黑名单敏感前缀 + value 类型收窄。Agent 仍可写大量合理配置
 * （application/* / display/* / rendering/* / physics/* / layer_names/* 等），
 * 但无法绕过黑名单。
 */

/** 写入即触发副作用 / 改编辑器行为的敏感前缀。 */
const FORBIDDEN_PROJECT_SETTING_PREFIXES: readonly string[] = [
  "autoload/",
  "input/",
  "debug/file_logging/",
  "debug/settings/stdout/verbose_stdout",
  "debug/settings/stdout/print_fps",
  "debug/gdscript/warnings/",
  "debug/shapes/",
  "debug/colors/",
  "network/tls/certificate_bundle_override",
  "project_settings_override/",
  "editor_plugins/enabled",
];

/** 整组禁止（精确匹配，不带尾斜杠）。 */
const FORBIDDEN_PROJECT_SETTING_EXACT: readonly string[] = [
  "editor_plugins/enabled",
  "debug/settings/stdout/print_fps",
  "debug/settings/stdout/verbose_stdout",
  "network/tls/certificate_bundle_override",
];

const MAX_ARRAY_ITEMS = 64;
const MAX_OBJECT_KEYS = 64;
/** 最多 1 层 Object/Array 嵌套（数组内对象、对象内对象），再深一层拒绝。 */
const MAX_VALUE_DEPTH = 2;

export type ProjectSettingGuardResult =
  | { ok: true; key: string; value: unknown }
  | { ok: false; error: string };

/** 真值类型 = 写入 ProjectSettings 时安全的 leaf 类型。 */
function isPrimitive(value: unknown): value is string | number | boolean {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

/** 递归校验 value 形状：所有叶子必须是 string / number / boolean。null 不允许。 */
function coerceValue(
  value: unknown,
  depth = 0,
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (value === null) {
    return { ok: false, error: "value 不允许 null（写入会被序列化为空）" };
  }
  if (isPrimitive(value)) {
    return { ok: true, value };
  }
  if (depth >= MAX_VALUE_DEPTH) {
    return {
      ok: false,
      error: `value 嵌套层级过深（>${MAX_VALUE_DEPTH}），请拍平后再写入`,
    };
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_ITEMS) {
      return { ok: false, error: `value 数组元素过多（>${MAX_ARRAY_ITEMS}）` };
    }
    const coerced: unknown[] = [];
    for (let i = 0; i < value.length; i += 1) {
      const item = value[i];
      const r = coerceValue(item, depth + 1);
      if (!r.ok) return { ok: false, error: `value[${i}]：${r.error}` };
      coerced.push(r.value);
    }
    return { ok: true, value: coerced };
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length > MAX_OBJECT_KEYS) {
      return { ok: false, error: `value 对象键过多（>${MAX_OBJECT_KEYS}）` };
    }
    const coerced: Record<string, unknown> = {};
    for (const k of keys) {
      const r = coerceValue(obj[k], depth + 1);
      if (!r.ok) return { ok: false, error: `value.${k}：${r.error}` };
      coerced[k] = r.value;
    }
    return { ok: true, value: coerced };
  }
  return {
    ok: false,
    error: "value 必须是 string / number / boolean / 简单数组 / 简单对象",
  };
}

/** 校验 key 是否命中敏感前缀。 */
function guardKey(rawKey: unknown): { ok: true; key: string } | { ok: false; error: string } {
  if (typeof rawKey !== "string") {
    return { ok: false, error: "key 必须是字符串（ProjectSettings 路径）" };
  }
  const key = rawKey.trim();
  if (!key) {
    return { ok: false, error: "key 不能为空" };
  }
  if (key.length > 256) {
    return { ok: false, error: "key 长度超过 256" };
  }
  // 限制字符：a-z 0-9 / _ .，避免注入换行 / 注释。结合 project.godot 解析行为。
  if (!/^[a-zA-Z][a-zA-Z0-9_/]*[a-zA-Z0-9]$/.test(key) && !/^[a-zA-Z]$/.test(key)) {
    return {
      ok: false,
      error: "key 必须是英文 ProjectSettings 路径（如 application/config/name）",
    };
  }
  for (const exact of FORBIDDEN_PROJECT_SETTING_EXACT) {
    if (key === exact) {
      return { ok: false, error: `不允许通过 RPC 修改该配置：${key}（敏感项）` };
    }
  }
  for (const prefix of FORBIDDEN_PROJECT_SETTING_PREFIXES) {
    if (key === prefix.slice(0, -1) || key.startsWith(prefix)) {
      return {
        ok: false,
        error: `不允许通过 RPC 修改该配置：${key}（敏感项：${prefix}）`,
      };
    }
  }
  return { ok: true, key };
}

/**
 * 校验整个 `set_project_setting` payload。返回归一化后的 key / value 或错误信息。
 * 校验顺序：先 key（避免无意义 value 序列化），再 value 类型。
 */
export function validateProjectSettingPayload(
  payload: { key: unknown; value: unknown },
): ProjectSettingGuardResult {
  const keyResult = guardKey(payload.key);
  if (!keyResult.ok) return keyResult;
  const valueResult = coerceValue(payload.value);
  if (!valueResult.ok) return { ok: false, error: valueResult.error };
  return { ok: true, key: keyResult.key, value: valueResult.value };
}

/** 暴露给测试：敏感前缀列表（黑名单本身稳定时可作为快照）。 */
export const FORBIDDEN_PROJECT_SETTING_PREFIXES_FOR_TEST = FORBIDDEN_PROJECT_SETTING_PREFIXES;
export const FORBIDDEN_PROJECT_SETTING_EXACT_FOR_TEST = FORBIDDEN_PROJECT_SETTING_EXACT;
