/** Verify renderer error/rejection reports carry no private error payload and are not duplicated. */
import { expect, it, vi } from "vitest";
import { installRendererFailureHandlers } from "./renderer-failures";
it("reports uncaught errors once without forwarding their payload", async () => {
  const target = new EventTarget(); const report = vi.fn(async () => undefined);
  const dispose = installRendererFailureHandlers(target as unknown as Window, report);
  target.dispatchEvent(new Event("error")); target.dispatchEvent(new Event("unhandledrejection"));
  expect(report).toHaveBeenCalledTimes(1); expect(report).toHaveBeenCalledWith();
  dispose(); target.dispatchEvent(new Event("error")); expect(report).toHaveBeenCalledTimes(1);
});
