// Optimistic check only: send visitors without a session cookie to /login.
// Real permission checks happen on the server in every page and action.

import { NextResponse, type NextRequest } from "next/server";

const PUBLIC = ["/login", "/forgot-password", "/reset-password"];

/**
 * Exact public asset paths that skip the session gate (favicon, app icons, PWA
 * manifest). Prefixes are listed separately — never a generic file-extension rule.
 *
 * `/icon.png` and `/apple-icon.png` are the App Router metadata file-convention
 * routes produced by `src/app/icon.png` and `src/app/apple-icon.png` (see
 * `next build` route list: `○ /icon.png`, `○ /apple-icon.png`). `/favicon.ico`
 * and `/site.webmanifest` come from `public/`.
 */
export const PUBLIC_ASSET_EXACT = [
  "/favicon.ico",
  "/icon.png",
  "/apple-icon.png",
  "/site.webmanifest",
] as const;

/** Public asset path prefixes (Next internals + brand kit under /public/brand/). */
export const PUBLIC_ASSET_PREFIXES = ["/_next/static", "/_next/image", "/brand/"] as const;

/**
 * Final middleware matcher (must be a static string for Next to parse at build time).
 * Exact names are `$`-anchored so /icon.png/x, /favicon.ico/anything, etc. still hit the proxy.
 */
export const PROXY_MATCHER =
  "/((?!_next/static|_next/image|brand/|favicon\\.ico$|icon\\.png$|apple-icon\\.png$|site\\.webmanifest$).*)";

/** True when the path is a no-auth static asset (matcher + proxy share this list). */
export function isPublicAssetPath(pathname: string): boolean {
  if (PUBLIC_ASSET_EXACT.includes(pathname as (typeof PUBLIC_ASSET_EXACT)[number])) return true;
  if (pathname.startsWith("/_next/static/") || pathname === "/_next/static") return true;
  if (pathname.startsWith("/_next/image/") || pathname === "/_next/image") return true;
  // Brand kit folder only — bare /brand is not public.
  if (pathname.startsWith("/brand/")) return true;
  return false;
}

/**
 * Whether the proxy session check should run for this pathname.
 * Mirrors `config.matcher`: returns false for the same paths the matcher skips.
 */
export function shouldCheckSession(pathname: string): boolean {
  return !isPublicAssetPath(pathname);
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // Defense in depth: even if the matcher is widened later, public assets stay open.
  if (isPublicAssetPath(pathname)) return NextResponse.next();
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  if (!req.cookies.has("hacien_session")) {
    // File downloads answer 401 instead of redirecting to the login page.
    if (pathname.startsWith("/files/")) {
      return new NextResponse("Sign in to download this file.", {
        status: 401,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
      });
    }
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return NextResponse.next();
}

export const config = {
  // Static string required by Next — keep identical to PROXY_MATCHER (tested).
  matcher: [
    "/((?!_next/static|_next/image|brand/|favicon\\.ico$|icon\\.png$|apple-icon\\.png$|site\\.webmanifest$).*)",
  ],
};
