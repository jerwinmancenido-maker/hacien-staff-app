import type { NextRequest } from "next/server";
import { ZodError } from "zod";
import { clientIp } from "../auth/client-ip";
import { db } from "../db";
import { CompanyRuleError } from "../services/companies";
import { ForbiddenError, assertCan, type Permission } from "../permissions";
import { runWithApiContext } from "./context";
import { ApiError } from "./errors";
import { apiError } from "./http";
import { serializeCustomer, type CustomerShape } from "./customers";
import { claimIdempotency, finishCall, hashRequestBody, parseIdempotencyKey, settleIdempotentWrite } from "./idempotency";
import { authenticateBearer, type ApiActor } from "./keys";
import { rateKind, reserveRateLimit, type RateKind } from "./rate-limit";
import { hasScope } from "./scopes";

export type ApiContext = {
  apiKeyId: string;
  user: ApiActor;
  ip: string;
  body: unknown;
};

type GuardOpts = {
  scope?: string;
  permission?: Permission;
  /** POST writes require Idempotency-Key. */
  idempotency?: "required";
};

function logServerError(e: unknown): void {
  const name = e instanceof Error ? e.name : "Error";
  const code = e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "";
  console.error(`[api] request failed name=${name}${code ? ` code=${code}` : ""}`);
}

function asApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  if (e instanceof ForbiddenError) return new ApiError(403, "forbidden", e.message);
  if (e instanceof CompanyRuleError) {
    return new ApiError(409, "rule", e.message, e.field ? { [e.field]: e.message } : undefined);
  }
  if (e instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of e.issues) {
      const key = issue.path.join(".") || "_";
      fields[key] ??= issue.message;
    }
    return new ApiError(400, "validation", "Fix the fields marked below.", fields);
  }
  logServerError(e);
  return new ApiError(500, "internal", "Something went wrong.");
}

async function readJsonBody(req: NextRequest): Promise<unknown> {
  const text = await req.text();
  if (!text.trim()) throw new ApiError(400, "invalid_json", "Send a JSON object.");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError(400, "invalid_json", "Send a JSON object.");
  }
}

async function storedPayload(res: Response): Promise<unknown> {
  const text = await res.clone().text();
  try {
    const body = text ? (JSON.parse(text) as unknown) : null;
    if (body && typeof body === "object") return body;
  } catch {
    // The handler returned non-JSON. Store a generic body so a retry cannot double-write.
  }
  return { ok: false, error: { code: "internal", message: "Something went wrong." } };
}

/**
 * Auth, per-key rate limit, scope, the acting user's UI permission, and
 * POST idempotency. Handlers call the existing services inside the audit context.
 */
export async function withApi(req: NextRequest, opts: GuardOpts, handler: (ctx: ApiContext) => Promise<Response>): Promise<Response> {
  const method = req.method.toUpperCase();
  const path = req.nextUrl.pathname.slice(0, 255);
  const kind: RateKind = rateKind(method);
  const ip = clientIp(req.headers);
  let logId: string | null = null;
  let claimedKey: string | null = null;
  try {
    const auth = await authenticateBearer(req.headers.get("authorization"), { method, path, kind });
    const slot = await reserveRateLimit({ apiKeyId: auth.apiKeyId, kind, method, path, ip });
    logId = slot.logId;
    if (!slot.ok) {
      throw new ApiError(429, "rate_limited", "Too many requests. Try again shortly.", undefined, slot.retryAfter);
    }
    if (opts.scope && !hasScope(auth.scopes, opts.scope)) {
      throw new ApiError(403, "forbidden", "This API key does not include that scope.");
    }
    if (opts.permission) assertCan(auth.user, opts.permission);

    const hasBody = method === "POST" || method === "PATCH" || method === "PUT";
    const body = hasBody ? await readJsonBody(req) : undefined;

    if (opts.idempotency === "required") {
      const idempotencyKey = parseIdempotencyKey(req.headers.get("idempotency-key"));
      const decision = await claimIdempotency({
        logId,
        apiKeyId: auth.apiKeyId,
        idempotencyKey,
        requestHash: hashRequestBody(body),
        method,
        path,
      });
      if (decision.type === "replay") {
        await finishCall(logId, decision.status);
        return Response.json(decision.body, {
          status: decision.status,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "private, no-store",
            "idempotency-replayed": "true",
          },
        });
      }
      if (decision.type === "conflict") {
        throw new ApiError(409, "idempotency_conflict", "This Idempotency-Key was already used for a different request.");
      }
      if (decision.type === "in_progress") {
        throw new ApiError(409, "idempotency_in_progress", "A request with this Idempotency-Key is already running.");
      }
      claimedKey = idempotencyKey;
    }

    const res = await runWithApiContext(
      {
        apiKeyId: auth.apiKeyId,
        ip,
        settleWrite: claimedKey
          ? async (tx, record) => {
              const customer = serializeCustomer(record as CustomerShape, auth.user);
              await settleIdempotentWrite(tx, {
                logId: logId as string,
                idempotencyKey: claimedKey as string,
                status: 201,
                body: { ok: true, data: { customer } },
              });
            }
          : undefined,
      },
      () => handler({ apiKeyId: auth.apiKeyId, user: auth.user, ip, body }),
    );
    if (claimedKey) {
      const stored = await db.apiCallLog.findUnique({ where: { id: logId as string }, select: { status: true, responseJson: true } });
      // The customer transaction already stored the result. A missing result means it did not commit.
      if (!stored || stored.status === 0 || stored.responseJson == null) {
        throw new ApiError(500, "internal", "Something went wrong.");
      }
    } else if (logId) {
      await finishCall(logId, res.status);
    }
    return res;
  } catch (e) {
    const error = asApiError(e);
    if (logId) {
      if (claimedKey) {
        const res = apiError(error);
        await finishCall(logId, res.status, await storedPayload(res));
        return res;
      }
      await finishCall(logId, error.status);
    }
    return apiError(error);
  }
}
