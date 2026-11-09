import { AsyncLocalStorage } from "node:async_hooks";

/** Carried into writeAudit while a /api/v1 handler calls an existing service. */
export type ApiAuditContext = {
  apiKeyId: string;
  ip: string | null;
};

const storage = new AsyncLocalStorage<ApiAuditContext>();

export function runWithApiContext<T>(ctx: ApiAuditContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}

export function currentApiAudit(): ApiAuditContext | null {
  return storage.getStore() ?? null;
}
