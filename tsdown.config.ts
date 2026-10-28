import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/cli.ts"],
  outDir: "dist",
  format: "esm",
  platform: "node",
  target: "node24.11.0",
  outExtensions: () => ({ js: ".mjs" }),
  sourcemap: true,
  dts: false,
  clean: true,
});
