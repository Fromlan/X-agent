/// <reference types="vite/client" />

import type { XAgentApi } from "../shared/ipc";

declare global {
  interface Window {
    xAgent: XAgentApi;
    xAgentPath?: {
      getForFile(file: File): string;
    };
  }
}

export {};
