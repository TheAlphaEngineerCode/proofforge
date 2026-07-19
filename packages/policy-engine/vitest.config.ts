import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "policy-engine",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
