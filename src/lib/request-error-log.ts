// One JSON log line per server request error (B-1).
//
// While Sentry has no DSN, the Hostinger runtime log is the only place a
// server error is recorded — and the raw Next.js output there does not
// reliably include the Prisma error code. This formatter keeps the line
// small and greppable: route, error digest (the same digest the error
// screen shows, so a staff screenshot can be matched to the log), the
// error code when the error carries one (P1001, P1017, …), and the
// message, truncated.

export function requestErrorLogLine(
  error: unknown,
  routePath?: string | null,
): string {
  const e = (error ?? {}) as {
    digest?: unknown;
    code?: unknown;
    message?: unknown;
  };
  const message =
    typeof e.message === "string" ? e.message : String(error);
  return JSON.stringify({
    level: "error",
    kind: "request_error",
    route: routePath ?? null,
    digest: typeof e.digest === "string" ? e.digest : null,
    code: typeof e.code === "string" ? e.code : null,
    message: message.slice(0, 500),
  });
}
