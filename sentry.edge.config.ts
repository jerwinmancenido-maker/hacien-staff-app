// Sentry edge config. Imported by instrumentation.ts for the edge runtime.
// No SENTRY_DSN = Sentry stays off. Free plan, light: tracesSampleRate 0.1,
// no session replay, no profiling. No source map upload.

import * as Sentry from "@sentry/nextjs";
import { sentryBeforeSend, sentryEnvironment } from "./src/lib/sentry";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: sentryEnvironment(),
    tracesSampleRate: 0.1,
    beforeSend: sentryBeforeSend,
  });
}
