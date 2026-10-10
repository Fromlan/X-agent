/** Notify main about uncaught renderer failures without sending exception bodies or arbitrary user content. */
export function installRendererFailureHandlers(target: Pick<Window, "addEventListener" | "removeEventListener">, report: () => Promise<unknown>): () => void {
  let reported = false;
  const handler = () => {
    if (reported) return;
    reported = true;
    void report().catch(() => console.error("X-agent 无法记录界面异常，请重新启动"));
  };
  target.addEventListener("error", handler);
  target.addEventListener("unhandledrejection", handler);
  return () => { target.removeEventListener("error", handler); target.removeEventListener("unhandledrejection", handler); };
}
