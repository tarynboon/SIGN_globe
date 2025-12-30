import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    target: "es2018",
    outDir: "dist-embed",
    emptyOutDir: true,
    lib: {
      entry: "src/embed.js",
      name: "SignGlobe",
      formats: ["iife"],
      fileName: () => "sign-globe-widget.js"
    }
  }
});
