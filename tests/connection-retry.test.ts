// B-1: the one-retry wrapper for transient database connection failures.
// Only P1001 / P1017 / client-initialisation errors are retried, exactly
// once; everything else propagates immediately, and a second failure of
// any kind propagates too (writes are never wrapped — see the module).

import { readFileSync } from "node:fs";
import path from "node:path";

import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  isConnectionError,
  withConnectionRetry,
} from "../src/lib/connection-retry";

function knownError(code: string) {
  return new Prisma.PrismaClientKnownRequestError("boom", {
    code,
    clientVersion: "6.19.3",
  });
}

const noSleep = () => Promise.resolve();

describe("isConnectionError", () => {
  it("accepts P1001 (can't reach database server)", () => {
    expect(isConnectionError(knownError("P1001"))).toBe(true);
  });

  it("accepts P1017 (server closed the connection)", () => {
    expect(isConnectionError(knownError("P1017"))).toBe(true);
  });

  it("accepts a client initialisation error", () => {
    expect(
      isConnectionError(
        new Prisma.PrismaClientInitializationError("no engine", "6.19.3"),
      ),
    ).toBe(true);
  });

  it("rejects other Prisma errors and plain errors", () => {
    expect(isConnectionError(knownError("P2002"))).toBe(false);
    expect(isConnectionError(knownError("P2025"))).toBe(false);
    expect(isConnectionError(new Error("P1001 in a message is not enough"))).toBe(
      false,
    );
    expect(isConnectionError(null)).toBe(false);
    expect(isConnectionError("P1001")).toBe(false);
  });
});

describe("withConnectionRetry", () => {
  it("passes a first-try success straight through", async () => {
    const fn = vi.fn(async () => 42);
    await expect(
      withConnectionRetry(fn, { sleep: noSleep }),
    ).resolves.toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries once after a connection error and returns the result", async () => {
    const sleep = vi.fn(noSleep);
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(knownError("P1001"))
      .mockResolvedValueOnce("ok");
    await expect(
      withConnectionRetry(fn, { delayMs: 123, sleep }),
    ).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(123);
  });

  it("does not retry a non-connection error", async () => {
    const fn = vi.fn(async (): Promise<string> => {
      throw knownError("P2002");
    });
    await expect(withConnectionRetry(fn, { sleep: noSleep })).rejects.toThrow(
      "boom",
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("propagates the second failure when the retry also fails", async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(knownError("P1017"))
      .mockRejectedValueOnce(knownError("P1001"));
    await expect(withConnectionRetry(fn, { sleep: noSleep })).rejects.toThrow(
      "boom",
    );
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

// Source pin: (app) layout wraps its read-only settings block the same way
// Home wraps loadHomeDashboard. requireUser must stay outside the retry.
describe("(app) layout settings-read retry wiring", () => {
  const layout = readFileSync(
    path.join(process.cwd(), "src/app/(app)/layout.tsx"),
    "utf8",
  );

  it("imports withConnectionRetry and keeps requireUser outside the retry", () => {
    expect(layout).toContain('from "@/lib/connection-retry"');
    expect(layout).toMatch(
      /const user = await requireUser\(\);\s*[\s\S]*?await withConnectionRetry\(/,
    );
    // requireUser must not appear inside the retry callback body.
    const retryStart = layout.indexOf("await withConnectionRetry(");
    expect(retryStart).toBeGreaterThan(-1);
    const afterRetry = layout.slice(retryStart);
    const callbackEnd = afterRetry.indexOf("});");
    expect(callbackEnd).toBeGreaterThan(-1);
    expect(afterRetry.slice(0, callbackEnd)).not.toContain("requireUser");
  });

  it("retries the settings / feature / non-VAT reads inside withConnectionRetry", () => {
    const retryStart = layout.indexOf("await withConnectionRetry(");
    const afterRetry = layout.slice(retryStart);
    const callbackEnd = afterRetry.indexOf("});");
    const body = afterRetry.slice(0, callbackEnd);
    expect(body).toContain("currentSessionLimits()");
    expect(body).toContain("getSettingsSnapshot()");
    expect(body).toContain("isCashEnabled()");
    expect(body).toContain("isPayablesEnabled()");
    expect(body).toContain("getNonVatMeter(");
    expect(body).toContain("isBooksEnabled()");
  });
});
