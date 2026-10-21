/** Define managed editor installations and validated commands shared by settings and the main process. */
import { Type, type Static } from "typebox";
import type { ClientPrefs } from "./ipc/prefs";

export const GodotEngineConfigSchema = Type.Object({
  path: Type.String({ minLength: 1, maxLength: 4096 }),
  name: Type.String({ minLength: 1, maxLength: 120 }),
  version: Type.String({ maxLength: 512 }),
}, { additionalProperties: false });

export type GodotEngineConfig = Static<typeof GodotEngineConfigSchema>;

/** Use a concise installation name while retaining the complete probed version as metadata. */
export function godotEngineName(version: string): string {
  const release = version.match(/^4\.\d+(?:\.\d+)?/)?.[0] ?? version;
  return `Godot ${release}${/mono|dotnet/i.test(version) ? " .NET" : ""}`;
}

const enginePath = Type.Union([Type.Null(), Type.String({ minLength: 1, maxLength: 4096 })]);
export const GodotEngineMutationSchema = Type.Union([
  Type.Object({ action: Type.Literal("add") }, { additionalProperties: false }),
  Type.Object({ action: Type.Literal("rename"), path: Type.String({ minLength: 1, maxLength: 4096 }), name: Type.String({ minLength: 1, maxLength: 120 }) }, { additionalProperties: false }),
  Type.Object({ action: Type.Literal("remove"), path: Type.String({ minLength: 1, maxLength: 4096 }) }, { additionalProperties: false }),
  Type.Object({ action: Type.Literal("default"), path: enginePath }, { additionalProperties: false }),
  Type.Object({ action: Type.Literal("project"), path: enginePath, projectPath: Type.String({ minLength: 1, maxLength: 4096 }) }, { additionalProperties: false }),
]);

export type GodotEngineMutation = Static<typeof GodotEngineMutationSchema>;
export type GodotEngineMutationResult = { ok: boolean; prefs?: ClientPrefs; canceled?: boolean; error?: string };
