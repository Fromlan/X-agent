/** Bound voice IPC payloads so audio and credentials stay on their owning side. */
export const DEEPSEEK_ASR_MAX_BYTES = 8 * 1024 * 1024;
export const DEEPSEEK_ASR_MAX_SECONDS = 120;
export const DEEPSEEK_TTS_MAX_CHARACTERS = 10_000;

export interface DeepSeekTranscribeInput {
  requestId: string;
  /** Actual 16-bit PCM WAV bytes, never a local path or renderer-supplied URL. */
  audio: Uint8Array;
}

export interface DeepSeekSpeakInput {
  requestId: string;
  text: string;
  voice?: "stella" | "tide";
}

export type DeepSeekVoiceFailure = { ok: false; error: string };
export type DeepSeekTranscribeResult =
  | { ok: true; text: string; durationMs: number }
  | DeepSeekVoiceFailure;
export type DeepSeekSpeakResult =
  | { ok: true; audio: Uint8Array; mimeType: "audio/wav" }
  | DeepSeekVoiceFailure;
