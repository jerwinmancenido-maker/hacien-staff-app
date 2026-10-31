import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ALLOWED_LOCAL_DB_HOSTS,
  assertLocalSeedShotsOrExit,
  checkLocalSeedShots,
  parseDatabaseUrlHost,
} from "../scripts/lib/assert-local-db.mjs";

describe("assert-local-db allowed hosts", () => {
  it("lists only loopback hosts (this repo has no compose MySQL service name)", () => {
    expect([...ALLOWED_LOCAL_DB_HOSTS]).toEqual(["localhost", "127.0.0.1"]);
  });
});

describe("parseDatabaseUrlHost", () => {
  it("reads the host and never needs the password", () => {
    expect(parseDatabaseUrlHost("mysql://user:s3cret@localhost:3306/hacien")).toBe("localhost");
    expect(parseDatabaseUrlHost("mysql://user:s3cret@127.0.0.1:3306/hacien_test")).toBe("127.0.0.1");
    expect(parseDatabaseUrlHost("mysql://u:p@db.staging.example.com:3306/hacien")).toBe("db.staging.example.com");
  });

  it("returns null for missing or garbage URLs", () => {
    expect(parseDatabaseUrlHost(undefined)).toBeNull();
    expect(parseDatabaseUrlHost("")).toBeNull();
    expect(parseDatabaseUrlHost("   ")).toBeNull();
    expect(parseDatabaseUrlHost("not-a-url")).toBeNull();
    expect(parseDatabaseUrlHost("mysql://")).toBeNull();
  });
});

describe("checkLocalSeedShots", () => {
  const localUrl = "mysql://hacien:secret@127.0.0.1:3306/hacien_dev";

  it("refuses a remote host", () => {
    const r = checkLocalSeedShots({
      ALLOW_SEED_SHOTS: "1",
      DATABASE_URL: "mysql://u:p@db.production.example.com:3306/hacien",
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected refusal");
    expect(r.host).toBe("db.production.example.com");
    expect(r.error).toMatch(/db\.production\.example\.com/);
    expect(r.error).toMatch(/not local/);
    expect(r.error).not.toMatch(/secret|hacien:|PASSWORD/i);
  });

  it("refuses a staging-like remote host", () => {
    const r = checkLocalSeedShots({
      ALLOW_SEED_SHOTS: "1",
      DATABASE_URL: "mysql://app:pw@staging-db.internal:3306/hacien_staging",
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected refusal");
    expect(r.host).toBe("staging-db.internal");
    expect(r.error).toMatch(/staging-db\.internal/);
    expect(r.error).not.toMatch(/:pw@|PASSWORD/i);
  });

  it("refuses when ALLOW_SEED_SHOTS opt-in is missing", () => {
    const r = checkLocalSeedShots({ DATABASE_URL: localUrl });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected refusal");
    expect(r.error).toMatch(/ALLOW_SEED_SHOTS=1/);
    expect(r.error).toMatch(/unset/);
  });

  it("refuses when ALLOW_SEED_SHOTS is not exactly 1", () => {
    expect(checkLocalSeedShots({ ALLOW_SEED_SHOTS: "true", DATABASE_URL: localUrl }).ok).toBe(false);
    expect(checkLocalSeedShots({ ALLOW_SEED_SHOTS: "yes", DATABASE_URL: localUrl }).ok).toBe(false);
    expect(checkLocalSeedShots({ ALLOW_SEED_SHOTS: "0", DATABASE_URL: localUrl }).ok).toBe(false);
  });

  it("refuses a missing DATABASE_URL", () => {
    const r = checkLocalSeedShots({ ALLOW_SEED_SHOTS: "1" });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected refusal");
    expect(r.error).toMatch(/DATABASE_URL is missing/);
  });

  it("refuses a garbage DATABASE_URL", () => {
    const r = checkLocalSeedShots({ ALLOW_SEED_SHOTS: "1", DATABASE_URL: ":::bad:::" });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected refusal");
    expect(r.error).toMatch(/could not be parsed|garbage/i);
    expect(r.error).not.toMatch(/:::bad/);
  });

  it("allows localhost with ALLOW_SEED_SHOTS=1", () => {
    const r = checkLocalSeedShots({
      ALLOW_SEED_SHOTS: "1",
      DATABASE_URL: "mysql://hacien:secret@localhost:3306/hacien_dev",
    });
    expect(r).toEqual({ ok: true, host: "localhost" });
  });

  it("allows 127.0.0.1 with ALLOW_SEED_SHOTS=1", () => {
    const r = checkLocalSeedShots({ ALLOW_SEED_SHOTS: "1", DATABASE_URL: localUrl });
    expect(r).toEqual({ ok: true, host: "127.0.0.1" });
  });
});

describe("assertLocalSeedShotsOrExit", () => {
  it("exits non-zero without printing credentials", () => {
    const lines: string[] = [];
    let code: number | null = null;
    assertLocalSeedShotsOrExit(
      { ALLOW_SEED_SHOTS: "1", DATABASE_URL: "mysql://u:SuperSecret@remote.db:3306/x" },
      {
        error: (...args: unknown[]) => lines.push(args.map(String).join(" ")),
        exit: (c: number) => {
          code = c;
        },
      },
    );
    expect(code).toBe(1);
    expect(lines.join("\n")).toMatch(/remote\.db/);
    expect(lines.join("\n")).not.toMatch(/SuperSecret/);
  });
});

describe("seed-shot scripts wire the guard before PrismaClient", () => {
  const root = process.cwd();

  it("guards home-a-seed-shots and home-sales-07-seed-shots", () => {
    for (const rel of ["scripts/home-a-seed-shots.mjs", "scripts/home-sales-07-seed-shots.mjs"]) {
      const src = readFileSync(path.join(root, rel), "utf8");
      expect(src).toMatch(/assertLocalSeedShotsOrExit\(\)/);
      expect(src).toMatch(/assert-local-db\.mjs/);
      const guardAt = src.indexOf("assertLocalSeedShotsOrExit()");
      const clientAt = src.indexOf("new PrismaClient(");
      expect(guardAt).toBeGreaterThan(-1);
      expect(clientAt).toBeGreaterThan(guardAt);
    }
  });
});
