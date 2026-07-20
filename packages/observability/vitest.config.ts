import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "observability",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
