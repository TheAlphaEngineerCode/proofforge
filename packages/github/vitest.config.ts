import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "github",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
