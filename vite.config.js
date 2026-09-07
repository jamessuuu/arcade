import { defineConfig } from "vite";
import { resolve } from "node:path";

/**
 * Three pages, one bundle graph. `base: "./"` keeps every asset reference
 * relative so the built site works from a subdirectory, from a file:// path,
 * or from any host, without a rebuild — which matters because where this is
 * hosted is James's decision and has not been made.
 */
export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    assetsDir: "assets",
    // Turned off: a sourcemap comment is harmless, but the network-capture
    // receipt is easier to trust when the shipped bundle has no references to
    // anything the page did not ask for.
    sourcemap: false,
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, "index.html"),
        parents: resolve(import.meta.dirname, "parents.html"),
        harborWatch: resolve(import.meta.dirname, "harbor-watch.html"),
      },
    },
  },
  server: {
    port: 5178,
    strictPort: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
});
