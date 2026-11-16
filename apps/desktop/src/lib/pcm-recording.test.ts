/** Verify browser WAV encoding independently from microphone devices. */
import { afterEach, expect, it, vi } from "vitest";
import { encodePcmWav, startPcmRecording } from "./pcm-recording";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("writes a real mono PCM WAV header and clamps the signed sample range", () => {
  const wav = encodePcmWav(new Float32Array([-2, -1, 0, 1, 2]));
  const view = new DataView(wav.buffer);
  expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe("RIFF");
  expect(new TextDecoder().decode(wav.subarray(8, 12))).toBe("WAVE");
  expect(view.getUint32(4, true)).toBe(wav.length - 8);
  expect(view.getUint16(20, true)).toBe(1);
  expect(view.getUint16(22, true)).toBe(1);
  expect(view.getUint32(24, true)).toBe(16_000);
  expect(view.getUint32(28, true)).toBe(32_000);
  expect(view.getUint16(34, true)).toBe(16);
  expect(view.getUint32(40, true)).toBe(10);
  expect([0, 1, 2, 3, 4].map((i) => view.getInt16(44 + i * 2, true))).toEqual([-32768, -32768, 0, 32767, 32767]);
});

/** Install a device-free capture graph with observable resource lifetimes. */
function microphone() {
  const stop = vi.fn();
  const close = vi.fn(async () => undefined);
  const processor = { connect: vi.fn(), disconnect: vi.fn(), onaudioprocess: null as null | ((event: { inputBuffer: { getChannelData(index: number): Float32Array } }) => void) };
  const source = { connect: vi.fn(), disconnect: vi.fn() };
  const gain = { connect: vi.fn(), disconnect: vi.fn(), gain: { value: 1 } };
  const resume = vi.fn(async () => undefined);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })) } });
  vi.stubGlobal("AudioContext", class {
    sampleRate = 16_000;
    destination = {};
    resume = resume;
    close = close;
    createMediaStreamSource = () => source;
    createScriptProcessor = () => processor;
    createGain = () => gain;
  });
  return { stop, close, processor, source, gain, resume };
}

it("stops the microphone before delivering WAV and emits completion once", async () => {
  const device = microphone();
  const completed = vi.fn();
  const recording = await startPcmRecording(completed);
  expect(device.gain.gain.value).toBe(0);
  device.processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => new Float32Array([0, 0.5]) } });
  recording.stop();
  recording.stop();
  expect(device.stop).toHaveBeenCalledOnce();
  expect(device.close).toHaveBeenCalledOnce();
  expect(device.source.disconnect).toHaveBeenCalledOnce();
  expect(completed).toHaveBeenCalledOnce();
  expect(completed.mock.calls[0][0]).toEqual(encodePcmWav(new Float32Array([0, 0.5])));
});

it("releases capture without delivering cancelled recordings", async () => {
  const device = microphone();
  const completed = vi.fn();
  const recording = await startPcmRecording(completed);
  recording.cancel();
  expect(device.stop).toHaveBeenCalledOnce();
  expect(completed).not.toHaveBeenCalled();
});

it("automatically completes recording at the 120-second limit", async () => {
  vi.useFakeTimers();
  const device = microphone();
  const completed = vi.fn();
  await startPcmRecording(completed);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(device.stop).toHaveBeenCalledOnce();
  expect(completed).toHaveBeenCalledOnce();
});

it("releases the microphone if audio graph setup fails", async () => {
  const device = microphone();
  device.resume.mockRejectedValueOnce(new Error("audio device unavailable"));
  await expect(startPcmRecording(vi.fn())).rejects.toThrow("audio device unavailable");
  expect(device.stop).toHaveBeenCalledOnce();
  expect(device.close).toHaveBeenCalledOnce();
});
