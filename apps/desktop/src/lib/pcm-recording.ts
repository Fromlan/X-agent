/** Capture bounded microphone PCM and encode the WAV format required by DeepSeek ASR. */
import { DEEPSEEK_ASR_MAX_SECONDS } from "@shared/deepseek-voice";

/** Encode mono floating-point samples as little-endian 16-bit PCM WAV. */
export function encodePcmWav(samples: Float32Array, sampleRate = 16_000): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  /** Write an ASCII chunk tag without relying on a Node encoder. */
  const tag = (offset: number, value: string): void => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  tag(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, Math.round(value < 0 ? value * 0x8000 : value * 0x7fff), true);
  }
  return bytes;
}

export interface PcmRecording {
  stop(): void;
  cancel(): void;
}

/** Request the microphone only on an explicit click and always release its tracks. */
export async function startPcmRecording(onComplete: (audio: Uint8Array) => void): Promise<PcmRecording> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, sampleRate: 16_000, echoCancellation: true, noiseSuppression: true },
    video: false,
  });
  let context: AudioContext | undefined;
  try {
    context = new AudioContext({ sampleRate: 16_000 });
    await context.resume();
    const source = context.createMediaStreamSource(stream);
    // Electron supports ScriptProcessor in the isolated renderer. Keeping the
    // processor local avoids admitting executable blob modules through CSP.
    const processor = context.createScriptProcessor(4096, 1, 1);
    const silent = context.createGain();
    silent.gain.value = 0;
    source.connect(processor);
    processor.connect(silent);
    silent.connect(context.destination);
    const chunks: Float32Array[] = [];
    const sampleRate = context.sampleRate;
    const maximum = DEEPSEEK_ASR_MAX_SECONDS * sampleRate;
    let count = 0;
    let finished = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    /** Release capture resources before optionally delivering the finished WAV. */
    const finish = (deliver: boolean): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      processor.onaudioprocess = null;
      source.disconnect();
      processor.disconnect();
      silent.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      void context?.close().catch(() => undefined);
      if (!deliver) return;
      const samples = new Float32Array(count);
      let offset = 0;
      for (const chunk of chunks) { samples.set(chunk, offset); offset += chunk.length; }
      onComplete(encodePcmWav(samples, sampleRate));
    };

    processor.onaudioprocess = (event): void => {
      if (finished) return;
      const input = event.inputBuffer.getChannelData(0);
      const copy = input.slice(0, Math.max(0, maximum - count));
      chunks.push(copy);
      count += copy.length;
      if (count >= maximum) finish(true);
    };
    timer = setTimeout(() => finish(true), DEEPSEEK_ASR_MAX_SECONDS * 1000);
    return { stop: () => finish(true), cancel: () => finish(false) };
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    void context?.close().catch(() => undefined);
    throw error;
  }
}
