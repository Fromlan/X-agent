/** Verify renderer error/rejection reports carry no private error payload and are not duplicated. */
import { expect, it, vi } from "vitest";
import { installRendererFailureHandlers } from "./renderer-failures";
it("reports uncaught errors once without forwarding their payload", async () => {
  const target = new EventTarget(); const report = vi.fn(async () => undefined);
  const dispose = installRendererFailureHandlers(target as unknown as Window, report);
  target.dispatchEvent(new Event("error")); target.dispatchEvent(new Event("unhandledrejection"));
  await Promise.resolve();
  expect(report).toHaveBeenCalledTimes(1); expect(report).toHaveBeenCalledWith({ kind: "error", reason: "unknown" });
  dispose(); target.dispatchEvent(new Event("error")); expect(report).toHaveBeenCalledTimes(1);
});

/** Dispatch a rejection event in Node without creating a genuinely unhandled test Promise. */
function rejection(target: EventTarget, reason: unknown): void {
  const event = new Event("unhandledrejection");
  Object.defineProperty(event, "reason", { value: reason });
  target.dispatchEvent(event);
}

it("classifies network/abort rejections without consuming the later fatal report", async () => {
  const target = new EventTarget(); const report = vi.fn(async () => undefined);
  installRendererFailureHandlers(target as unknown as Window, report);
  rejection(target, new Error("Connection error. private API key"));
  rejection(target, "Request was aborted.");
  rejection(target, new DOMException("private body", "AbortError"));
  rejection(target, new TypeError("unrelated programming failure private source"));
  await Promise.resolve();
  expect(report.mock.calls.map((call) => call[0])).toEqual([
    { kind: "rejection", reason: "network" }, { kind: "rejection", reason: "aborted" },
    { kind: "rejection", reason: "aborted" }, { kind: "rejection", reason: "TypeError" },
  ]);
  expect(JSON.stringify(report.mock.calls)).not.toContain("private");
});

it("a runtime ErrorEvent is fatal even when its message resembles a network failure", async () => {
  const target = new EventTarget(); const report = vi.fn(async () => undefined);
  installRendererFailureHandlers(target as unknown as Window, report);
  const event = new Event("error");
  Object.defineProperty(event, "error", { value: new Error("Connection error.") });
  target.dispatchEvent(event); rejection(target, new Error("Connection error."));
  await Promise.resolve();
  expect(report).toHaveBeenCalledExactlyOnceWith({ kind: "error", reason: "network" });
});

it("keeps programming exceptions fatal even when an identifier resembles network terminology", async () => {
  const target = new EventTarget(); const report = vi.fn(async () => undefined);
  installRendererFailureHandlers(target as unknown as Window, report);
  rejection(target, new ReferenceError("network is not defined"));
  await Promise.resolve();
  expect(report).toHaveBeenCalledExactlyOnceWith({ kind: "rejection", reason: "ReferenceError" });
});

it("recognizes translated network/abort errors wrapped by Electron IPC", async () => {
  const target = new EventTarget(); const report = vi.fn(async () => undefined);
  installRendererFailureHandlers(target as unknown as Window, report);
  rejection(target, new Error("Error invoking remote method 'prompt': Error: 网络异常：与供应商的连接中断"));
  rejection(target, new Error("Error invoking remote method 'prompt': Error: 操作已中止"));
  await Promise.resolve();
  expect(report.mock.calls.map((call) => call[0])).toEqual([
    { kind: "rejection", reason: "network" }, { kind: "rejection", reason: "aborted" },
  ]);
});

it("contains synchronous failures of the diagnostic reporter", async () => {
  const target = new EventTarget();
  const output = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    installRendererFailureHandlers(target as unknown as Window, () => { throw new Error("private reporter failure"); });
    rejection(target, new Error("Connection error."));
    await vi.waitFor(() => expect(output).toHaveBeenCalledExactlyOnceWith("X-agent 无法记录界面异常，请重新启动"));
  } finally { output.mockRestore(); }
});
