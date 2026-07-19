import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  dts: false,
  clean: true,
  sourcemap: true,
  target: "es2022",
});
