// B-1: the one-retry wrapper for transient database connection failures.
// Only P1001 / P1017 / client-initialisation errors are retried, exactly
// once; everything else propagates immediately, and a second failure of
// any kind propagates too (writes are never wrapped — see the module).

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
