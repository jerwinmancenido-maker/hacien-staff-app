import { defineConfig } from "vitest/config";
import path from "node:path";

const alias = { "@": path.resolve(__dirname, "src") };

const sharedEnv = {
  SESSION_SECRET: process.env.SESSION_SECRET || "test-session-secret-at-least-16-chars",
  DATABASE_URL: process.env.DATABASE_URL || "",
  TEST_DATABASE_URL: process.env.TEST_DATABASE_URL || "",
};

/**
 * Two projects under one `npm test`:
 * - unit: parallel (default)
 * - db: fileParallelism off — shared MySQL + SettingsVersion.version races
 *   when booklet / quotes suites save settings concurrently across files.
 * Serializing DB files is simpler and more reliable than per-worker databases
 * (no CREATE DATABASE privilege, no migrate-per-worker, same TEST_DATABASE_URL).
 */
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/db/**"],
          testTimeout: 60_000,
          hookTimeout: 120_000,
          env: sharedEnv,
        },
      },
      {
        resolve: { alias },
        test: {
          name: "db",
          environment: "node",
          include: ["tests/db/**/*.test.ts"],
          // One DB file at a time — avoids SettingsVersion_version_key unique flakes.
          fileParallelism: false,
          globalSetup: ["tests/db/global-setup.ts"],
          testTimeout: 60_000,
          hookTimeout: 120_000,
          env: sharedEnv,
        },
      },
    ],
  },
});
