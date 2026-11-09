// No hard deletes anywhere, except one case: an active Admin deleting a draft
// or void quote, or a void sales order, billing, or collection. That path
// lives only in src/lib/services/document-delete.ts, which holds a private
// AsyncLocalStorage and registers a reader here. The extension allows Prisma
// `delete` of the models in that store, and only while the store is active.
// `deleteMany` and raw DELETE/TRUNCATE stay blocked. Ordinary call sites
// cannot enter the store (the setter is not exported) and cannot replace the
// reader (bind once). ESLint (eslint.config.mjs) still flags raw SQL DELETE.
// tests/no-delete.test.ts allow-lists only the delete service file.

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

/**
 * Reader installed once by the document-delete service. False until then,
 * and false whenever that service is not inside its private allowance.
 * A second bind is refused so another module cannot turn deletes on.
 */
let allowsModel: (model: string) => boolean = () => false;
let allowanceBound = false;

export function bindDocumentDeleteAllowance(reader: (model: string) => boolean): void {
  if (allowanceBound) {
    throw new HardDeleteError("allowance", "bindDocumentDeleteAllowance");
  }
  allowanceBound = true;
  allowsModel = reader;
}

export function assertNotDelete(model: string | undefined, operation: string): void {
  if ((BLOCKED_OPERATIONS as readonly string[]).includes(operation)) {
    // Prisma delete only, and only for a model the private allowance names.
    if (operation === "delete" && model && allowsModel(model)) return;
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
