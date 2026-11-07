/** Page CSP. Prints use same-origin fonts, inline styles, and window.print(). Not applied to /files. */
export const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data:",
  // Sentry browser events POST to the ingest host (only used when a DSN is
  // set; harmless otherwise). Without this the browser blocks the send.
  "connect-src 'self' https://*.ingest.sentry.io",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

/** Dev React refresh needs eval. Production responses do not send it. */
export function pageCsp(nodeEnv = process.env.NODE_ENV): string {
  if (nodeEnv === "development") {
    return PAGE_CSP.replace("script-src 'self' 'unsafe-inline'", "script-src 'self' 'unsafe-inline' 'unsafe-eval'");
  }
  return PAGE_CSP;
}

export const securityHeaders: { key: string; value: string }[] = [
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Content-Security-Policy", value: PAGE_CSP },
];
