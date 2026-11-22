import { Prisma, PrismaClient } from "@prisma/client";
import { noDeleteExtension } from "./no-delete.ts";

/**
 * Explicit per-process connection cap for the runtime client.
 *
 * The database sits in a shared Hostinger MySQL pool: 120 connections
 * shared by four Node sites on the account. Without a cap, Prisma sizes
 * each process pool by its own default (2 x physical CPUs + 1) — a
 * host-dependent number nobody chose. One server process per site means
 * this app's worst-case draw is the cap itself: 5 of 120 (~4%), one
 * sixth of an equal per-site share (30), leaving 115 for the other three
 * sites. 5 is also the value already proven safe for this app live.
 */
export const DB_CONNECTION_LIMIT = 5;

/**
 * Return the datasource URL with `connection_limit` set to the cap,
 * unless the URL already carries its own `connection_limit` (an explicit
 * value in the environment always wins). Undefined passes through so a
 * missing DATABASE_URL fails exactly as it did before this cap existed.
 */
export function cappedDatasourceUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (/[?&]connection_limit=/.test(url)) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}connection_limit=${DB_CONNECTION_LIMIT}`;
}

function createClient() {
  const datasourceUrl = cappedDatasourceUrl(process.env.DATABASE_URL);
  return new PrismaClient(datasourceUrl ? { datasourceUrl } : undefined).$extends(noDeleteExtension);
}

export type Db = ReturnType<typeof createClient>;
/** Transaction client passed to `db.$transaction(async (tx) => …)`. */
export type Tx = Parameters<Parameters<Db["$transaction"]>[0]>[0];

const globalForPrisma = globalThis as unknown as { prisma?: Db };

export const db: Db = globalForPrisma.prisma ?? createClient();

globalForPrisma.prisma = db;

/** A unique constraint was hit (e.g. two people saving the same email or TIN at once). */
export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/** A foreign key blocked the write (e.g. a row was linked after the guard count). */
export function isForeignKeyViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003";
}
