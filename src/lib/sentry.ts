// Shared Sentry setup for the HACIEN staff app (server, edge, browser).
// Sentry stays OFF unless a DSN is set — the configs gate on the env var, so
// with no DSN the app builds and runs exactly as it does now. Free-plan light:
// tracesSampleRate 0.1, no session replay, no profiling.

import type { ErrorEvent } from "@sentry/nextjs";

/** Sentry environment tag: staging / production, from the environment. */
export function sentryEnvironment(): string | undefined {
  // Server/edge read SENTRY_ENVIRONMENT; the browser build only inlines
  // NEXT_PUBLIC_* vars, so the client reads NEXT_PUBLIC_SENTRY_ENVIRONMENT.
  // An empty string counts as unset.
  return process.env.SENTRY_ENVIRONMENT || process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || undefined;
}

/**
 * Never send passwords, tokens or customer TINs. Request bodies (login forms,
 * 2303 uploads, any form POST) and cookies are stripped from every event, as
 * are Authorization / Cookie headers. Everything else (route, error, stack)
 * is kept so the event is still useful.
 */
export function sentryBeforeSend(event: ErrorEvent): ErrorEvent | null {
  const request = event.request;
  if (request) {
    delete request.data;
    delete request.cookies;
    if (request.headers) {
      for (const name of Object.keys(request.headers)) {
        if (/^(authorization|cookie)$/i.test(name)) {
          delete request.headers[name];
        }
      }
    }
  }
  return event;
}
