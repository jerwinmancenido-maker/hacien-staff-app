import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Plain Node.js server (Hostinger): no edge runtime, no Vercel-only features.
  poweredByHeader: false,
};

export default nextConfig;
