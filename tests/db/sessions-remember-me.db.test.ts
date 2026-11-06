// "Keep me signed in" (2026-11-07) against a real MySQL 8 database (TEST_DATABASE_URL).
// Run: TEST_DATABASE_URL=mysql://hacien:local_only_dummy@127.0.0.1:3306/hacien_test npm test -- tests/db/sessions-remember-me.db.test.ts
// createSession itself needs a request scope (it writes the cookie), so the
// sign-in path is covered by the staging self-test; this file covers what the
// database can prove — the flag persists, and the stored flag picks the limits.

import { beforeAll, describe, expect, it, vi } from "vitest";

const hasDb = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return !!url;
});

import { db } from "@/lib/db";
import { hashToken } from "@/lib/auth/tokens";
import { REMEMBER_SESSION_MS, SESSION_MS, sessionLimits, sessionPastIdle } from "@/lib/auth/session";
import { makeUser } from "./fixtures";

describe.skipIf(!hasDb)("remembered sessions (MySQL)", () => {
  let userId: string;
  const day = 24 * 60 * 60 * 1000;

  beforeAll(async () => {
    const user = await makeUser("staff");
    userId = user.id;
  });

  // No cleanup: the no-delete rule blocks deleteMany even in tests, and the
  // throwaway test DB is dropped and recreated for each full-suite run.

  it("persists the rememberMe flag on the session row", async () => {
    const row = await db.session.create({
      data: {
        tokenHash: hashToken("remember-me-test-token"),
        userId,
        expiresAt: new Date(Date.now() + REMEMBER_SESSION_MS),
        rememberMe: true,
      },
    });
    const read = await db.session.findUniqueOrThrow({ where: { id: row.id } });
    expect(read.rememberMe).toBe(true);

    const plain = await db.session.create({
      data: {
        tokenHash: hashToken("plain-test-token"),
        userId,
        expiresAt: new Date(Date.now() + SESSION_MS),
      },
    });
    expect((await db.session.findUniqueOrThrow({ where: { id: plain.id } })).rememberMe).toBe(false);
  });

  it("the stored flag picks the limits: 8 days in, remembered is alive, standard is dead", async () => {
    const start = new Date(Date.now() - 8 * day);
    const now = new Date();
    const remembered = await db.session.create({
      data: {
        tokenHash: hashToken("remember-me-8-days"),
        userId,
        createdAt: start,
        expiresAt: new Date(now.getTime() + 7 * day),
        rememberMe: true,
      },
    });
    const standard = await db.session.create({
      data: {
        tokenHash: hashToken("plain-8-days"),
        userId,
        createdAt: start,
        expiresAt: new Date(start.getTime() + SESSION_MS),
        rememberMe: false,
      },
    });
    const [r, s] = await Promise.all([
      db.session.findUniqueOrThrow({ where: { id: remembered.id } }),
      db.session.findUniqueOrThrow({ where: { id: standard.id } }),
    ]);
    expect(sessionPastIdle({ createdAt: r.createdAt, expiresAt: r.expiresAt, now }, sessionLimits(r.rememberMe).maxMs)).toBe(false);
    expect(sessionPastIdle({ createdAt: s.createdAt, expiresAt: s.expiresAt, now }, sessionLimits(s.rememberMe).maxMs)).toBe(true);
  });
});
