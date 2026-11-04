import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  base: "./",
  // maplibre-gl's web worker breaks under Vite's dependency pre-bundling
  // (the worker chunk 404s). Excluding it from optimizeDeps lets it load
  // as the library intends.
  optimizeDeps: { exclude: ["maplibre-gl"] },
});
