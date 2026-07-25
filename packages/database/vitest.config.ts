import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "database",
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Both database test files point at the one TEST_DATABASE_URL, and the
    // migration test drops the schema to start where a new deployment does.
    // Run in parallel they would pull the tables out from under each other.
    fileParallelism: false,
  },
});
