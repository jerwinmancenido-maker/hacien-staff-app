// App Router server instrumentation: loads the Sentry server/edge config for
// the runtime this process runs on. With no SENTRY_DSN the configs are
// no-ops and the app starts exactly as before.

import * as Sentry from "@sentry/nextjs";

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
export const onRequestError = Sentry.captureRequestError;
