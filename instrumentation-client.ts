// Sentry browser config. Loaded automatically by the App Router.
// No NEXT_PUBLIC_SENTRY_DSN = Sentry stays off in the browser.
// Free plan, light: tracesSampleRate 0.1, no session replay, no profiling.

import * as Sentry from "@sentry/nextjs";
import { sentryBeforeSend, sentryEnvironment } from "./src/lib/sentry";

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: sentryEnvironment(),
    tracesSampleRate: 0.1,
    beforeSend: sentryBeforeSend,
  });
}
