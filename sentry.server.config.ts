// Sentry server config (Node.js runtime). Imported by instrumentation.ts.
// No SENTRY_DSN = Sentry stays off; the app builds and runs exactly as now.
// Free plan, light: tracesSampleRate 0.1, no session replay, no profiling.
// No source map upload (no SENTRY_AUTH_TOKEN needed).

import * as Sentry from "@sentry/nextjs";
import { sentryBeforeSend, sentryEnvironment } from "./src/lib/sentry";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: sentryEnvironment(),
    tracesSampleRate: 0.1,
    beforeSend: sentryBeforeSend,
    // server.mjs owns process-level crash handling (it logs the JSON boot line,
    // captures the error to Sentry itself, then exits) — the SDK's built-in
    // uncaught/unhandled handlers would send the same crash a second time.
    integrations: (defaults) =>
      defaults.filter((i) => i.name !== "OnUncaughtException" && i.name !== "OnUnhandledRejection"),
  });
}
