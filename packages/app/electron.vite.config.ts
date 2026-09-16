/**
 * electron-vite configuration.
 *
 * Three separate builds:
 *   - main:     Node-side process that owns the app lifecycle & IPC handlers
 *   - preload:  thin bridge script exposing a small `window.molio` API
 *   - renderer: React UI (Vite + JSX)
 *
 * `better-sqlite3` is a native module and must NOT be bundled into main.
 * We mark it external so Node's loader picks the rebuilt binary at runtime.
 */
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ESM-safe equivalents of CommonJS __dirname / __filename.
const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  main: {
    // `@molio2-editor/core` is excluded from the externalize set so
    // its sources are inlined into `out/main/index.js`. Without this,
    // electron-builder chokes when packaging because the workspace
    // symlink to the sibling package points outside `packages/app/`
    // and its filter logic refuses paths that aren't under the app.
    // Inlining keeps the runtime self-contained and lets the
    // installer build cleanly.
    plugins: [externalizeDepsPlugin({ exclude: ["@molio2-editor/core"] })],
    build: {
      lib: {
        entry: resolve(__dirname, "src/main/index.ts"),
        formats: ["es"],
      },
      rollupOptions: {
        output: { entryFileNames: "[name].js", format: "es" },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ["@molio2-editor/core"] })],
    build: {
      lib: {
        // Preload stays CJS. ESM preload is officially supported in
        // Electron 28+ but flaky in practice — `contextBridge.exposeInMainWorld`
        // silently no-ops if anything goes wrong during preload load, leaving
        // `window.molio` undefined. CJS preload is battle-tested.
        //
        // The `.cjs` extension overrides the package-level `type: module`
        // so Node treats this specific file as CommonJS.
        entry: resolve(__dirname, "src/preload/index.ts"),
        formats: ["cjs"],
      },
      rollupOptions: {
        output: { entryFileNames: "[name].cjs", format: "cjs" },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/renderer/index.html"),
        },
      },
    },
  },
});
