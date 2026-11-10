import { writeAudit } from "../audit";
import { db } from "../db";
import { DocRuleError, DOC_TX, withTxRetry } from "../documents/common";
import { ensureApiBotUser } from "./bot-user";
import { generateApiKey } from "./keys";
import { parseScopes, sanitizeScopes } from "./scopes";

/**
 * Admin management of /api/v1 keys (Settings → API Keys). The raw token is
 * returned ONCE by createApiKey and never stored — only its prefix and
 * pepper-HMAC hash are kept. Revoke is a timestamp, never a delete (the
 * no-delete rule covers keys too: call logs and audit rows point at them).
 */

export type ApiKeyListRow = {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  createdByName: string | null;
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  status: "active" | "revoked" | "expired";
};

export async function listApiKeys(): Promise<ApiKeyListRow[]> {
  const rows = await db.apiKey.findMany({
    orderBy: { createdAt: "desc" },
    include: { createdBy: { select: { name: true } } },
  });
  const now = new Date();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    keyPrefix: r.keyPrefix,
    scopes: parseScopes(r.scopes),
    createdByName: r.createdBy?.name ?? null,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    revokedAt: r.revokedAt,
    lastUsedAt: r.lastUsedAt,
    status: r.revokedAt ? "revoked" : r.expiresAt && r.expiresAt <= now ? "expired" : "active",
  }));
}

export async function createApiKey(input: {
  name: string;
  scopes: readonly string[];
  expiresAt: Date | null;
  actorId: string;
}): Promise<{ id: string; token: string; keyPrefix: string }> {
  const name = input.name.trim();
  if (name.length < 3 || name.length > 120) {
    throw new DocRuleError("Give the key a name of 3 to 120 characters.");
  }
  const scopes = sanitizeScopes(input.scopes);
  if (scopes.length === 0) {
    throw new DocRuleError("Pick at least one scope for the key.");
  }
  // Throws a 503 ApiError while API_KEY_PEPPER is unset — key creation
  // fails closed, exactly like key authentication (plan v2, decision 4).
  const material = generateApiKey();
  const bot = await ensureApiBotUser();
  return withTxRetry(() =>
    db.$transaction(async (tx) => {
      const row = await tx.apiKey.create({
        data: {
          name,
          keyPrefix: material.keyPrefix,
          keyHash: material.keyHash,
          scopes,
          actingUserId: bot.id,
          createdById: input.actorId,
          expiresAt: input.expiresAt,
        },
      });
      await writeAudit(tx, {
        userId: input.actorId,
        entityType: "Settings",
        entityId: row.id,
        action: "create",
        before: null,
        after: { kind: "api_key", name, keyPrefix: material.keyPrefix, scopes, status: "active" },
        diff: false,
      });
      return { id: row.id, token: material.token, keyPrefix: material.keyPrefix };
    }, DOC_TX),
  );
}

export async function revokeApiKey(input: { id: string; actorId: string }): Promise<void> {
  await withTxRetry(() =>
    db.$transaction(async (tx) => {
      const row = await tx.apiKey.findUnique({ where: { id: input.id } });
      if (!row) throw new DocRuleError("That API key no longer exists.");
      if (row.revokedAt) throw new DocRuleError("That API key is already revoked.");
      const revokedAt = new Date();
      await tx.apiKey.update({ where: { id: row.id }, data: { revokedAt } });
      const scopes = parseScopes(row.scopes);
      await writeAudit(tx, {
        userId: input.actorId,
        entityType: "Settings",
        entityId: row.id,
        action: "update",
        before: { kind: "api_key", name: row.name, keyPrefix: row.keyPrefix, scopes, status: "active" },
        after: { kind: "api_key", name: row.name, keyPrefix: row.keyPrefix, scopes, status: "revoked" },
        diff: false,
      });
    }, DOC_TX),
  );
}
