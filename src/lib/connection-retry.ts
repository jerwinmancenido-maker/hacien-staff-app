// One retry for a transient database connection failure (B-1).
//
// The post-sign-in "Something went wrong" screen was traced to a brief
// connection failure on the first, heaviest page load: Prisma reported
// P1001 "Can't reach database server" when the cold pool opened its first
// connections under the Home page's parallel fan-out (staging runtime log,
// 2026-11-14 23:37:50 PHT). A single retry after a short wait rides out
// that blip instead of failing the whole render.
//
// SERVER-ONLY: imports the Prisma client. Never import from a client
// component. READ-ONLY loads only — never wrap a write, because a retry
// after a write could apply it twice if the first attempt actually landed.

import { Prisma } from "@prisma/client";

/** True for the transient connection failures a single retry can fix. */
export function isConnectionError(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    // P1001: can't reach the database server. P1017: server closed the
    // connection (e.g. an idle socket dropped by MySQL's wait_timeout).
    return e.code === "P1001" || e.code === "P1017";
  }
  // Client failed to initialise at all (engine/connection startup).
  return e instanceof Prisma.PrismaClientInitializationError;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn`; if it fails with a transient connection error, wait once and
 * run it exactly once more. Any other error — and a second failure of any
 * kind — propagates unchanged.
 */
export async function withConnectionRetry<T>(
  fn: () => Promise<T>,
  opts?: { delayMs?: number; sleep?: (ms: number) => Promise<void> },
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!isConnectionError(e)) throw e;
    await (opts?.sleep ?? defaultSleep)(opts?.delayMs ?? 750);
    return fn();
  }
}
