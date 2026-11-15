// App Router server instrumentation: loads the Sentry server/edge config for
// the runtime this process runs on. With no SENTRY_DSN the configs are
// no-ops and the app starts exactly as before.

import * as Sentry from "@sentry/nextjs";

import { requestErrorLogLine } from "./src/lib/request-error-log";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Captures errors Next.js catches in server components, route handlers and
// server actions, so they reach Sentry instead of only the server log.
// While Sentry has no DSN, the Hostinger runtime log is the only record,
// so each error is also written there as one JSON line carrying the error
// digest and any Prisma error code (B-1 — see src/lib/request-error-log.ts).
export const onRequestError: typeof Sentry.captureRequestError = (
  error,
  request,
  errorContext,
) => {
  console.error(requestErrorLogLine(error, errorContext.routePath));
  Sentry.captureRequestError(error, request, errorContext);
};
