import type { NextConfig } from "next";
import { pageCsp, securityHeaders } from "./src/lib/security-headers";

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
  // @napi-rs/canvas is a native module (a .node binary): Turbopack cannot
  // bundle it into the route chunk ("non-ecmascript placeable asset"), so
  // it stays external and loads from node_modules at runtime — the same
  // way the OCR worker files do (traced below for the standalone output).
  serverExternalPackages: ["@napi-rs/canvas"],
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
  // The 2303 readers load files by path at runtime, so the standalone
  // tracer cannot see them — Hostinger runs the standalone server,
  // whose node_modules holds only traced files. Without these, both
  // readers fail on staging with "Missing file in the app install".
  // The whole tesseract packages are included because the worker
  // thread loads its own helpers (getCore, gunzip, cache) and the
  // core (tesseract.js-core) by relative require at runtime — and the
  // worker's own dependencies (wasm-feature-detect, bmp-js, is-url,
  // node-fetch, regenerator-runtime, zlibjs) the same way. A worker
  // that cannot load its requires dies before answering, and the
  // photo read then hangs until its timeout instead of failing fast.
  outputFileTracingIncludes: {
    "/api/customers/parse-2303": [
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "./node_modules/pdfjs-dist/legacy/build/pdf.mjs",
      "./node_modules/@napi-rs/canvas/**/*",
      "./node_modules/@napi-rs/canvas-linux-x64-gnu/**/*",
      "./node_modules/tesseract.js/**/*",
      "./node_modules/tesseract.js-core/**/*",
      "./node_modules/@tesseract.js-data/eng/4.0.0/**/*",
      "./node_modules/wasm-feature-detect/**/*",
      "./node_modules/bmp-js/**/*",
      "./node_modules/is-url/**/*",
      "./node_modules/node-fetch/**/*",
      "./node_modules/regenerator-runtime/**/*",
      "./node_modules/zlibjs/**/*",
    ],
  },
  ...(hostingerBuild ? { typescript: { ignoreBuildErrors: true } } : {}),
};

export default nextConfig;
