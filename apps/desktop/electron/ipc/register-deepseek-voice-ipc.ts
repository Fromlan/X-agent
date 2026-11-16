/** Register sender-guarded voice operations against the actual active session. */
import type { IpcMain } from "electron";
import type { SessionHost } from "../agent/session-host";
import { DeepSeekVoiceService } from "../agent/deepseek-voice";
import { IPC_CHANNELS } from "../../shared/ipc-channels";
import { handle } from "./register-ipc";

/** Reuse the host session runtime so custom provider credentials never cross IPC. */
export function registerDeepSeekVoiceIpc(ipcMain: IpcMain, host: SessionHost): void {
  const voice = new DeepSeekVoiceService({ getSession: () => host.getBundle()?.session ?? null });
  handle(ipcMain, IPC_CHANNELS.deepseekTranscribe, (_event, input) => voice.transcribe(input));
  handle(ipcMain, IPC_CHANNELS.deepseekSpeak, (_event, input) => voice.speak(input));
  handle(ipcMain, IPC_CHANNELS.deepseekCancelVoice, (_event, requestId) => voice.cancel(requestId));
}
