import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "database",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
