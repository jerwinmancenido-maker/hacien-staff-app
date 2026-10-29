import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Database suites (tests/db) run only when TEST_DATABASE_URL is set; this
    // applies the migrations to that database first.
    globalSetup: ["tests/db/global-setup.ts"],
    // The numbering tests open many connections at once.
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
