/** Privacy-minimized diagnostic contracts exclude user paths, conversation text and credentials by construction. */
export type DiagnosticKind = "main-exception" | "main-rejection" | "renderer-gone" | "renderer-error" | "child-gone";
export type DiagnosticEvent = { at: number; kind: DiagnosticKind; reason: string };
export type DiagnosticSnapshot = {
  version: 1; appVersion: string; nodeVersion: string; electronVersion: string;
  platform: string; architecture: string; osRelease: string;
  memory: { rss: number; heapUsed: number };
  state: { status: string; mode: string; sessionActive: boolean; godotClients: number };
  events: DiagnosticEvent[];
};
