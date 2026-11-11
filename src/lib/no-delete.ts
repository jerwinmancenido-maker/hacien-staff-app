// No hard deletes anywhere, except one case: an active Admin deleting a draft
// or void quote, or a void sales order, billing, or collection. That path
// (src/lib/services/document-delete.ts) runs its deletes through the
// allowance gate below, whose run method is keyed by DELETE_ALLOWANCE_KEY —
// a symbol only that service imports (tests/no-delete.test.ts source-scans
// the importers). The extension then allows Prisma `delete` only for the
// models named in that call, and only until the call returns. deleteMany
// and raw DELETE/TRUNCATE stay blocked. ESLint (eslint.config.mjs) still
// flags raw SQL DELETE. tests/no-delete.test.ts allow-lists only the delete
// service file for Prisma delete calls.

import { AsyncLocalStorage } from "node:async_hooks";
import { Prisma } from "@prisma/client";
import { DELETE_ALLOWANCE_KEY } from "./delete-allowance-key";

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

const deleteAllowance = new AsyncLocalStorage<ReadonlySet<string>>();

/**
 * The delete allowance gate. Its only member is keyed by
 * DELETE_ALLOWANCE_KEY (src/lib/delete-allowance-key.ts), so holding this
 * object grants nothing — the run method can be invoked only from a file
 * that imports the key, and tests/no-delete.test.ts pins those importers
 * to the delete service. Running `fn` through it allows Prisma `delete`
 * only for `models`, and only until the call returns; nested deletes of
 * any other model still throw, and deleteMany and raw SQL are never
 * allowed.
 */
export const deleteAllowanceGate = {
  [DELETE_ALLOWANCE_KEY]<T>(models: readonly string[], fn: () => T): T {
    return deleteAllowance.run(new Set(models), fn);
  },
};

export function assertNotDelete(model: string | undefined, operation: string): void {
  if ((BLOCKED_OPERATIONS as readonly string[]).includes(operation)) {
    const allowed = operation === "delete" && !!model && deleteAllowance.getStore()?.has(model) === true;
    if (allowed) return;
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
