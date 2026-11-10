import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "../db";
import type { PermissionUser } from "../permissions";
import { ApiError } from "./errors";
import { parseScopes } from "./scopes";

export const API_KEY_PREFIX_LEN = 8;
const PEPPER_MIN = 16;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

const USER_SELECT = {
  id: true,
  isAdmin: true,
  isApprover: true,
  isStaff: true,
  isViewer: true,
  active: true,
  canSeeCosts: true,
} as const;

export type ApiActor = PermissionUser & { id: string };

export type AuthedKey = {
  apiKeyId: string;
  scopes: string[];
  user: ApiActor;
};

/**
 * Pepper for the key HMAC. Fail closed: no fallback to SESSION_SECRET, and
 * no key check runs while this is missing or shorter than 16 characters.
 */
export function apiKeyPepper(): string {
  const pepper = process.env.API_KEY_PEPPER;
  if (!pepper || pepper.length < PEPPER_MIN) {
    throw new ApiError(503, "pepper_unset", "API authentication is not configured.");
  }
  return pepper;
}

/** HMAC-SHA256 hex. The raw key is never stored. */
export function hashApiKey(token: string): string {
  return createHmac("sha256", apiKeyPepper()).update(token).digest("hex");
}

/** New key material. The token is shown once by the caller; only prefix + hash are stored. */
export function generateApiKey(): { token: string; keyPrefix: string; keyHash: string } {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    keyPrefix: token.slice(0, API_KEY_PREFIX_LEN),
    keyHash: hashApiKey(token),
  };
}

/** At most the lookup prefix. Never the full key. */
export function maskApiKeyForLog(token: string | null | undefined): string {
  if (!token) return "-";
  const slice = token.slice(0, API_KEY_PREFIX_LEN).replace(/[^A-Za-z0-9_-]/g, "");
  return slice || "-";
}

function logAuthFailure(reason: string, token: string | null): void {
  console.error(`[api] auth failed reason=${reason} prefix=${maskApiKeyForLog(token)}`);
}

/** Bearer token, or null. Query strings are ignored — keys must not land in URLs. */
export function bearerToken(header: string | null): string | null {
  if (!header || header.length > 180) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!match) return null;
  const token = match[1]!;
  if (!TOKEN_RE.test(token)) return null;
  return token;
}

function presentedToken(header: string | null): string | null {
  if (!header || header.length > 180) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1]! : null;
}

async function recordAuthFailure(apiKeyId: string, method: string, path: string, kind: "read" | "write"): Promise<void> {
  try {
    await db.apiCallLog.create({
      data: {
        apiKeyId,
        method: method.slice(0, 10),
        path: path.slice(0, 255),
        status: 401,
        kind,
      },
    });
  } catch (e) {
    const name = e instanceof Error ? e.name : "Error";
    console.error(`[api] auth failure log skipped name=${name}`);
  }
}

/**
 * Prefix lookup, then HMAC compare. Rejects a missing pepper before any query.
 * Revoked, expired, and inactive acting users are rejected. The raw key is not logged.
 */
export async function authenticateBearer(
  header: string | null,
  meta: { method: string; path: string; kind: "read" | "write" },
): Promise<AuthedKey> {
  apiKeyPepper();
  const token = bearerToken(header);
  if (!token) {
    logAuthFailure("bad_key", presentedToken(header));
    throw new ApiError(401, "unauthorized", "API key is not valid.");
  }
  const keyHash = hashApiKey(token);
  const prefix = token.slice(0, API_KEY_PREFIX_LEN);
  const rows = await db.apiKey.findMany({
    where: { keyPrefix: prefix },
    include: { actingUser: { select: USER_SELECT } },
  });
  const expected = Buffer.from(keyHash, "hex");
  let match: (typeof rows)[number] | null = null;
  for (const row of rows) {
    const got = Buffer.from(row.keyHash, "hex");
    if (got.length === expected.length && timingSafeEqual(got, expected)) match = row;
  }
  if (!match) {
    logAuthFailure("bad_key", token);
    throw new ApiError(401, "unauthorized", "API key is not valid.");
  }
  if (match.revokedAt) {
    logAuthFailure("revoked", token);
    await recordAuthFailure(match.id, meta.method, meta.path, meta.kind);
    throw new ApiError(401, "revoked", "API key is revoked.");
  }
  if (match.expiresAt && match.expiresAt.getTime() <= Date.now()) {
    logAuthFailure("expired", token);
    await recordAuthFailure(match.id, meta.method, meta.path, meta.kind);
    throw new ApiError(401, "expired", "API key is expired.");
  }
  const user = match.actingUser;
  if (!user.active) {
    logAuthFailure("inactive_user", token);
    await recordAuthFailure(match.id, meta.method, meta.path, meta.kind);
    throw new ApiError(401, "unauthorized", "API key is not valid.");
  }
  return {
    apiKeyId: match.id,
    scopes: parseScopes(match.scopes),
    user: {
      id: user.id,
      isAdmin: user.isAdmin,
      isApprover: user.isApprover,
      isStaff: user.isStaff,
      isViewer: user.isViewer,
      active: user.active,
      canSeeCosts: user.canSeeCosts,
    },
  };
}
