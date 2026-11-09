import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db, isUniqueViolation } from "../db";
import { ApiError } from "./errors";

const IDEM_RE = /^[A-Za-z0-9._:-]{8,191}$/;

export type IdempotencyDecision =
  | { type: "fresh" }
  | { type: "conflict" }
  | { type: "in_progress" }
  | { type: "replay"; status: number; body: unknown };

/** Same body with different key order hashes the same. */
export function hashRequestBody(body: unknown): string {
  return createHash("sha256").update(canonical(body)).digest("hex");
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(",")}}`;
}

/** Missing or unusable Idempotency-Key on a POST. */
export function parseIdempotencyKey(header: string | null): string {
  const value = (header ?? "").trim();
  if (!value) {
    throw new ApiError(400, "idempotency_key_required", "Idempotency-Key is required on this request.");
  }
  if (!IDEM_RE.test(value)) {
    throw new ApiError(400, "idempotency_key_required", "Idempotency-Key must be 8–191 letters, numbers, or . _ : -.");
  }
  return value;
}

export function judgeIdempotency(
  existing: { requestHash: string | null; method: string; path: string; status: number; responseJson: unknown },
  request: { requestHash: string; method: string; path: string },
): IdempotencyDecision {
  if (existing.requestHash !== request.requestHash || existing.method !== request.method || existing.path !== request.path) {
    return { type: "conflict" };
  }
  if (existing.status === 0 || existing.responseJson == null) return { type: "in_progress" };
  return { type: "replay", status: existing.status, body: existing.responseJson };
}

/**
 * Attach the Idempotency-Key to this call's log row, or report that another
 * row already owns it. The raw key is a client id, not an API key.
 */
export async function claimIdempotency(input: {
  logId: string;
  apiKeyId: string;
  idempotencyKey: string;
  requestHash: string;
  method: string;
  path: string;
}): Promise<IdempotencyDecision> {
  const existing = await db.apiCallLog.findFirst({
    where: { apiKeyId: input.apiKeyId, idempotencyKey: input.idempotencyKey },
  });
  if (existing) {
    return judgeIdempotency(existing, input);
  }
  try {
    await db.apiCallLog.update({
      where: { id: input.logId },
      data: {
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        method: input.method.slice(0, 10),
        path: input.path.slice(0, 255),
      },
    });
    return { type: "fresh" };
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    const winner = await db.apiCallLog.findFirst({
      where: { apiKeyId: input.apiKeyId, idempotencyKey: input.idempotencyKey },
    });
    if (!winner) throw e;
    return judgeIdempotency(winner, input);
  }
}

export async function finishCall(logId: string, status: number, body?: unknown): Promise<void> {
  try {
    await db.apiCallLog.update({
      where: { id: logId },
      data: {
        status,
        ...(body !== undefined ? { responseJson: body as Prisma.InputJsonValue } : {}),
      },
    });
  } catch (e) {
    const name = e instanceof Error ? e.name : "Error";
    console.error(`[api] call log update skipped name=${name}`);
  }
}
