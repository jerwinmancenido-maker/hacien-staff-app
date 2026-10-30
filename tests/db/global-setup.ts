// Applies prisma migrations to TEST_DATABASE_URL before the database suites.
// Refuses any database whose name doesn't contain "test", so a real database
// can never be used by accident.

import { execFileSync } from "node:child_process";
import path from "node:path";

export function testDatabaseUrl(): string | null {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return null;
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!/test/i.test(name)) throw new Error(`TEST_DATABASE_URL must point at a database with "test" in its name (got "${name}").`);
  return url;
}

export default function setup() {
  const url = testDatabaseUrl();
  if (!url) {
    console.warn("TEST_DATABASE_URL is not set: skipping the database suites in tests/db.");
    return;
  }
  const root = path.resolve(__dirname, "../..");
  execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["prisma", "migrate", "deploy"], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}
