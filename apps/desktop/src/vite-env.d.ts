import type { XAgentApi } from "../shared/ipc";

declare global {
  interface Window {
    xAgent: XAgentApi;
  }
}

export {};
