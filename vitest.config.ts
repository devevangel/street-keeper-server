import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/tests/**/*.test.ts"],
    testTimeout: 60000, // Increased for Overpass API calls
    pool: "forks",
    isolate: true,
  },
});
