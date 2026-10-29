// No hard deletes anywhere. Master data is archived (`active`/`archivedAt`);
// documents (later) are voided (`voidedAt` + reason). This Prisma client
// extension makes any delete/deleteMany — and any raw SQL containing DELETE or
// TRUNCATE ($queryRaw, $executeRaw and their Unsafe variants) — throw before
// it reaches the database. ESLint (eslint.config.mjs) also flags raw SQL
// DELETE in source, and tests/no-delete.test.ts checks both.

import { Prisma } from "@prisma/client";

export class HardDeleteError extends Error {
  constructor(model: string | undefined, operation: string) {
    super(`Hard deletes are not allowed (${model ?? "unknown"}.${operation}). Archive or void the record instead.`);
    this.name = "HardDeleteError";
  }
}

export const BLOCKED_OPERATIONS = ["delete", "deleteMany"] as const;

export const RAW_OPERATIONS = ["$queryRaw", "$executeRaw", "$queryRawUnsafe", "$executeRawUnsafe"] as const;

/** Matches SQL statements that remove rows. Keep in sync with the ESLint rule. */
export const RAW_DELETE_PATTERN = /\b(DELETE|TRUNCATE)\b/i;

export function assertNotDelete(model: string | undefined, operation: string): void {
  if ((BLOCKED_OPERATIONS as readonly string[]).includes(operation)) {
    throw new HardDeleteError(model, operation);
  }
}

/** The SQL text of a raw query: `{ strings }` for tagged templates, `[sql, ...params]` for the Unsafe variants. */
export function rawSqlText(args: unknown): string {
  if (Array.isArray(args)) return typeof args[0] === "string" ? args[0] : "";
  if (args && typeof args === "object" && "strings" in args && Array.isArray(args.strings)) {
    return args.strings.join(" ");
  }
  if (typeof args === "string") return args;
  return "";
}

export function assertNotRawDelete(operation: string, args: unknown): void {
  if ((RAW_OPERATIONS as readonly string[]).includes(operation) && RAW_DELETE_PATTERN.test(rawSqlText(args))) {
    throw new HardDeleteError("raw SQL", operation);
  }
}

export const noDeleteExtension = Prisma.defineExtension({
  name: "no-hard-delete",
  query: {
    async $allOperations({ model, operation, args, query }) {
      if (model) assertNotDelete(model, operation);
      else assertNotRawDelete(operation, args);
      return query(args);
    },
  },
});
