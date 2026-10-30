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

const nextConfig: NextConfig = {
  // Plain Node.js server (Hostinger): no edge runtime, no Vercel-only features.
  poweredByHeader: false,
  experimental: {
    cpus: 1,
    workerThreads: false,
    serverActions: { bodySizeLimit: bodyLimit },
    proxyClientMaxBodySize: bodyLimit,
  },
  ...(hostingerBuild ? { typescript: { ignoreBuildErrors: true } } : {}),
};

export default nextConfig;
