import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db, isUniqueViolation, type Tx } from "../db";
import { ApiError } from "./errors";

const IDEM_RE = /^[A-Za-z0-9._:-]{8,191}$/;

/** Completed results can be reused as a new request after this. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
/** A pending claim older than this did not finish. The retry may take it over. */
export const IDEMPOTENCY_PENDING_MS = 60 * 1000;

export type IdempotencyDecision =
  | { type: "fresh" }
  | { type: "conflict" }
  | { type: "in_progress" }
  | { type: "stale" }
  | { type: "expired" }
  | { type: "replay"; status: number; body: unknown };

type IdempotencyRow = {
  requestHash: string | null;
  method: string;
  path: string;
  status: number;
  responseJson: unknown;
  at: Date;
};

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
  existing: IdempotencyRow,
  request: { requestHash: string; method: string; path: string },
  now = Date.now(),
): IdempotencyDecision {
  const age = now - existing.at.getTime();
  if (age >= IDEMPOTENCY_TTL_MS) return { type: "expired" };
  const pending = existing.status === 0 || existing.responseJson == null;
  // The write that owned this claim did not commit. A retry may proceed.
  if (pending && age >= IDEMPOTENCY_PENDING_MS) return { type: "stale" };
  const same =
    existing.requestHash === request.requestHash && existing.method === request.method && existing.path === request.path;
  if (!same) return { type: "conflict" };
  if (pending) return { type: "in_progress" };
  return { type: "replay", status: existing.status, body: existing.responseJson };
}

/**
 * Mark the claimed row complete. Call this inside the same transaction as the
 * customer write. If this row no longer owns the key, the caller must roll back.
 */
export async function settleIdempotentWrite(
  tx: Tx,
  input: { logId: string; idempotencyKey: string; status: number; body: unknown },
): Promise<void> {
  const stored = JSON.parse(JSON.stringify(input.body)) as Prisma.InputJsonValue;
  const updated = await tx.apiCallLog.updateMany({
    where: { id: input.logId, idempotencyKey: input.idempotencyKey, status: 0 },
    data: { status: input.status, responseJson: stored },
  });
  if (updated.count !== 1) {
    throw new ApiError(409, "idempotency_in_progress", "A request with this Idempotency-Key is already running.");
  }
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
  try {
    return await db.$transaction(async (tx) => {
      const existing = await tx.apiCallLog.findFirst({
        where: { apiKeyId: input.apiKeyId, idempotencyKey: input.idempotencyKey },
      });
      if (existing) {
        const decision = judgeIdempotency(existing, input);
        if (decision.type !== "stale" && decision.type !== "expired") return decision;
        // Release the key without deleting the old call row. The release is
        // qualified, mirroring settleIdempotentWrite: a stale claim is
        // released only while its row is still pending, and either way the
        // row must still hold the key. The snapshot above can cross the
        // original write's settle — an unqualified release would steal the
        // key from a completed write and let this retry duplicate it.
        const released = await tx.apiCallLog.updateMany({
          where: {
            id: existing.id,
            idempotencyKey: input.idempotencyKey,
            ...(decision.type === "stale" ? { status: 0 } : {}),
          },
          data: { idempotencyKey: null },
        });
        if (released.count !== 1) {
          // The claim moved under us: judge whoever holds the key now.
          const owner = await tx.apiCallLog.findFirst({
            where: { apiKeyId: input.apiKeyId, idempotencyKey: input.idempotencyKey },
          });
          if (!owner) {
            // A concurrent claim released it first; the key is free.
          } else {
            const again = judgeIdempotency(owner, input);
            if (again.type !== "stale" && again.type !== "expired") return again;
            throw new ApiError(409, "idempotency_in_progress", "A request with this Idempotency-Key is already running.");
          }
        }
      }
      await tx.apiCallLog.update({
        where: { id: input.logId },
        data: {
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
          method: input.method.slice(0, 10),
          path: input.path.slice(0, 255),
          status: 0,
          responseJson: Prisma.DbNull,
          at: new Date(),
        },
      });
      return { type: "fresh" };
    });
  } catch (e) {
    // A duplicate key aborts the transaction. Read the winner after it commits.
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
