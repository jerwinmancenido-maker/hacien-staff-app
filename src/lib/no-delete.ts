// No hard deletes anywhere. Master data is archived (`active`/`archivedAt`);
// documents (later) are voided (`voidedAt` + reason). This Prisma client
// extension makes any delete/deleteMany throw before it reaches the database.

import { Prisma } from "@prisma/client";

export class HardDeleteError extends Error {
  constructor(model: string | undefined, operation: string) {
    super(`Hard deletes are not allowed (${model ?? "unknown"}.${operation}). Archive or void the record instead.`);
    this.name = "HardDeleteError";
  }
}

export const BLOCKED_OPERATIONS = ["delete", "deleteMany"] as const;

export function assertNotDelete(model: string | undefined, operation: string): void {
  if ((BLOCKED_OPERATIONS as readonly string[]).includes(operation)) {
    throw new HardDeleteError(model, operation);
  }
}

export const noDeleteExtension = Prisma.defineExtension({
  name: "no-hard-delete",
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        assertNotDelete(model, operation);
        return query(args);
      },
    },
  },
});
