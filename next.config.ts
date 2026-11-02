import type { NextConfig } from "next";

// Business-document uploads go through a server action, so its body limit (1 MB
// by default) must fit the largest allowed file (UPLOAD_MAX_MB, default 10) plus
// multipart overhead. The proxy buffers request bodies up to its own limit too.
const uploadMaxMb = Math.min(50, Math.max(1, Math.floor(Number(process.env.UPLOAD_MAX_MB) || 10)));
const bodyLimit = `${uploadMaxMb + 1}mb` as const;

// Hostinger's shared Node.js build can't spawn worker threads ("OS can't spawn
// worker thread"), so the build runs on one CPU without workers. With
// HOSTINGER_BUILD=1 the build also skips its own type check: CI still runs
// `npm run lint` and `npm run typecheck` on every change.
const hostingerBuild = process.env.HOSTINGER_BUILD === "1";

/** Page CSP. Prints use same-origin fonts, inline styles, and window.print(). Not applied to /files. */
export const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
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

const nextConfig: NextConfig = {
  // Plain Node.js server (Hostinger): no edge runtime, no Vercel-only features.
  poweredByHeader: false,
  async headers() {
    return [
      {
        // Skip /files — those downloads already send default-src 'none'; sandbox.
        source: "/((?!files(?:/|$)).*)",
        headers: securityHeaders.map((h) => (h.key === "Content-Security-Policy" ? { ...h, value: pageCsp() } : h)),
      },
    ];
  },
  experimental: {
    cpus: 1,
    workerThreads: false,
    serverActions: { bodySizeLimit: bodyLimit },
    proxyClientMaxBodySize: bodyLimit,
  },
  ...(hostingerBuild ? { typescript: { ignoreBuildErrors: true } } : {}),
};

export default nextConfig;
