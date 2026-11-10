import { db } from "../db";

export const API_READ_LIMIT = 120;
export const API_WRITE_LIMIT = 30;
export const API_RATE_WINDOW_MS = 60_000;
export const API_LAST_USED_THROTTLE_MS = 60_000;

export type RateKind = "read" | "write";

export function rateKind(method: string): RateKind {
  const m = method.toUpperCase();
  return m === "GET" || m === "HEAD" ? "read" : "write";
}

export type RateReservation =
  | { ok: true; logId: string }
  | { ok: false; retryAfter: number; logId: string };

/**
 * Per-key DB limit. Locks the key row so two calls cannot both pass the count.
 * lastUsedAt moves at most once a minute.
 */
export async function reserveRateLimit(input: {
  apiKeyId: string;
  kind: RateKind;
  method: string;
  path: string;
  ip: string;
}): Promise<RateReservation> {
  const limit = input.kind === "read" ? API_READ_LIMIT : API_WRITE_LIMIT;
  const now = new Date();
  const windowStart = new Date(now.getTime() - API_RATE_WINDOW_MS);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM ApiKey WHERE id = ${input.apiKeyId} FOR UPDATE`;
    const key = await tx.apiKey.findUnique({ where: { id: input.apiKeyId }, select: { lastUsedAt: true } });
    if (!key?.lastUsedAt || now.getTime() - key.lastUsedAt.getTime() >= API_LAST_USED_THROTTLE_MS) {
      await tx.apiKey.update({
        where: { id: input.apiKeyId },
        data: { lastUsedAt: now, lastUsedIp: input.ip.slice(0, 64) },
      });
    }
    // 429 rows are logged but do not occupy a slot. Retry-After follows the
    // oldest counted request, so a client that waits is not blocked by its own rejections.
    const counted = {
      apiKeyId: input.apiKeyId,
      kind: input.kind,
      at: { gte: windowStart },
      NOT: { status: 429 },
    };
    const count = await tx.apiCallLog.count({ where: counted });
    if (count >= limit) {
      const oldest = await tx.apiCallLog.findFirst({ where: counted, orderBy: { at: "asc" }, select: { at: true } });
      const retryAfter = Math.max(1, Math.ceil(((oldest?.at.getTime() ?? now.getTime()) + API_RATE_WINDOW_MS - now.getTime()) / 1000));
      const row = await tx.apiCallLog.create({
        data: {
          apiKeyId: input.apiKeyId,
          method: input.method.slice(0, 10),
          path: input.path.slice(0, 255),
          status: 429,
          kind: input.kind,
        },
      });
      return { ok: false as const, retryAfter, logId: row.id };
    }
    const row = await tx.apiCallLog.create({
      data: {
        apiKeyId: input.apiKeyId,
        method: input.method.slice(0, 10),
        path: input.path.slice(0, 255),
        status: 0,
        kind: input.kind,
      },
    });
    return { ok: true as const, logId: row.id };
  });
}
