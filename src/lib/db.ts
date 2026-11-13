import { Prisma, PrismaClient } from "@prisma/client";
import { noDeleteExtension } from "./no-delete";

function createClient() {
  return new PrismaClient().$extends(noDeleteExtension);
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
