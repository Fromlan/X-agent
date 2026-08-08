import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve("electron/main.ts"),
        },
      },
    },
  },
  preload: {
    build: {
      // E5: sandbox 模式下 preload 只允许 require('electron') 等受限 API：
      // 关闭 electron-vite 默认 externalizeDeps（内联 typebox / shared 常量），
      // 仅 external electron，并输出 CJS 单文件（sandbox 不支持 ESM preload）。
      externalizeDeps: false,
      rollupOptions: {
        input: {
          index: resolve("electron/preload.ts"),
        },
        external: ["electron"],
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs",
        },
      },
    },
  },
  renderer: {
    root: ".",
    // Windows: Vite may bind only to [::1]; Electron resolves localhost to 127.0.0.1.
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve("index.html"),
        },
      },
    },
    resolve: {
      alias: {
        "@": resolve("src"),
        "@shared": resolve("shared"),
      },
    },
    plugins: [react()],
  },
});
