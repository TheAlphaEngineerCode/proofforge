import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "evidence-spec",
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // index.ts is a re-export barrel with no logic of its own.
      exclude: ["src/index.ts"],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
      },
    },
  },
});
