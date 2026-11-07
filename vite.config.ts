import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// maplibre-gl 6 starts its web worker from a file next to the bundled code
// (`new URL("maplibre-gl-worker.mjs", import.meta.url)`), which Vite does not
// see, so production builds shipped without it and the basemap never drew.
// Emit the worker beside the app's JS so that URL resolves under any base.
const maplibreWorker = (): Plugin => ({
  name: "caremap-maplibre-worker",
  apply: "build",
  generateBundle() {
    const file = createRequire(import.meta.url).resolve("maplibre-gl/dist/maplibre-gl-worker.mjs");
    this.emitFile({ type: "asset", fileName: "assets/maplibre-gl-worker.mjs", source: readFileSync(file) });
  },
});

export default defineConfig({
  plugins: [react(), maplibreWorker()],
  base: "./",
  // maplibre-gl's web worker breaks under Vite's dependency pre-bundling
  // (the worker chunk 404s). Excluding it from optimizeDeps lets it load
  // as the library intends.
  optimizeDeps: { exclude: ["maplibre-gl"] },
});
