import { ApiError } from "./errors";

export const API_PAGE_MAX = 10_000;
export const API_LIMIT_MAX = 100;
export const API_LIMIT_DEFAULT = 50;

const NO_STORE = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
};

export function apiOk(data: unknown, status = 200, extra?: Record<string, string>): Response {
  return Response.json(
    { ok: true, data },
    { status, headers: { ...NO_STORE, ...extra } },
  );
}

export function apiError(error: ApiError, extra?: Record<string, string>): Response {
  const headers: Record<string, string> = { ...NO_STORE, ...extra };
  if (error.retryAfter != null) headers["retry-after"] = String(error.retryAfter);
  return Response.json(
    {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.fields ? { fields: error.fields } : {}),
      },
    },
    { status: error.status, headers },
  );
}

/** page / limit for list routes. limit is capped at 100. */
export function parsePageLimit(search: URLSearchParams): { ok: true; page: number; limit: number } | { ok: false; error: string } {
  const pageRaw = search.get("page");
  const limitRaw = search.get("limit");
  const page = pageRaw == null || pageRaw === "" ? 1 : Number(pageRaw);
  const requested = limitRaw == null || limitRaw === "" ? API_LIMIT_DEFAULT : Number(limitRaw);
  if (!Number.isInteger(page) || page < 1 || page > API_PAGE_MAX) {
    return { ok: false, error: "page must be a whole number from 1 to 10000." };
  }
  if (!Number.isInteger(requested) || requested < 1) {
    return { ok: false, error: "limit must be a whole number of at least 1." };
  }
  return { ok: true, page, limit: Math.min(requested, API_LIMIT_MAX) };
}

export function decimalString(value: { toFixed: (n: number) => string } | null | undefined): string | null {
  if (value == null) return null;
  return value.toFixed(2);
}
