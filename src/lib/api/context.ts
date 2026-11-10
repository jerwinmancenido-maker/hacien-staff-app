import { AsyncLocalStorage } from "node:async_hooks";
import type { Tx } from "../db";

/**
 * Runs inside the service transaction that saved the record, so the idempotency
 * result commits with the write or rolls back with it.
 */
export type ApiWriteSettle = (tx: Tx, record: unknown) => Promise<void>;

/** Carried into writeAudit while a /api/v1 handler calls an existing service. */
export type ApiAuditContext = {
  apiKeyId: string;
  ip: string | null;
  settleWrite?: ApiWriteSettle;
};

const storage = new AsyncLocalStorage<ApiAuditContext>();

export function runWithApiContext<T>(ctx: ApiAuditContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}

export function currentApiAudit(): ApiAuditContext | null {
  return storage.getStore() ?? null;
}

/** No-op outside a claimed /api/v1 write. Failures roll the service transaction back. */
export async function settleApiWrite(tx: Tx, record: unknown): Promise<void> {
  const settle = currentApiAudit()?.settleWrite;
  if (settle) await settle(tx, record);
}
