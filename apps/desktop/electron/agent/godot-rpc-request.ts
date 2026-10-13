/** Route tool and IPC requests through one ProjectSettings guard before touching the editor. */
import { randomUUID } from "node:crypto";
import type { GodotRpcCall, GodotRpcResponse } from "../../shared/godot-rpc";
import { godotRpcTimeoutMs } from "../../shared/godot-rpc";
import { validateProjectSettingPayload } from "../../shared/godot-project-setting";
import type { GodotRpcBridge } from "./godot-rpc-bridge";

/** Validate and normalize sensitive writes at the boundary shared by both desktop entrances. */
export async function requestGuardedGodotRpc(
  bridge: Pick<GodotRpcBridge, "request">,
  call: GodotRpcCall,
  options?: { clientId?: string | null },
): Promise<GodotRpcResponse> {
  const id = randomUUID();
  if (call.method === "set_project_setting") {
    const guard = validateProjectSettingPayload(call);
    if (!guard.ok) return { id, ok: false, error: guard.error };
    call = { ...call, key: guard.key, value: guard.value };
  }
  const request = { ...call, id };
  return options === undefined
    ? bridge.request(request, godotRpcTimeoutMs(call))
    : bridge.request(request, godotRpcTimeoutMs(call), options);
}
