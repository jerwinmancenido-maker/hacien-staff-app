import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import {
  config,
  isPublicAssetPath,
  proxy,
  PROXY_MATCHER,
  PUBLIC_ASSET_EXACT,
  PUBLIC_ASSET_PREFIXES,
  shouldCheckSession,
} from "@/proxy";

/** Apply the real exported middleware matcher string to a pathname (as Next does). */
function matcherHits(pathname: string): boolean {
  const patterns = Array.isArray(config.matcher) ? config.matcher : [config.matcher];
  return patterns.some((pattern) => {
    // Next middleware matchers are path-to-regexp-ish; our patterns are a single
    // negative-lookahead form. Compile the same way: strip leading slash from the
    // pattern's "/((?!...).*)" and test against pathname without the leading slash
    // for the inner group — or test the full pathname against a RegExp derived
    // from the matcher string.
    const raw = pattern.startsWith("/") ? pattern.slice(1) : pattern;
    // Escape only what's needed: the matcher is already a regex-ish string.
    const re = new RegExp(`^${raw}$`);
    const path = pathname.startsWith("/") ? pathname.slice(1) : pathname;
    return re.test(path);
  });
}

function loggedOut(url: string) {
  return new NextRequest(url); // no hacien_session cookie
}

describe("proxy public-asset allowlist (security)", () => {
  it("lists only exact icon/favicon/manifest names and brand/_next prefixes (no extension wildcard)", () => {
    expect(PUBLIC_ASSET_EXACT).toEqual([
      "/favicon.ico",
      "/icon.png",
      "/apple-icon.png",
      "/icon",
      "/apple-icon",
      "/site.webmanifest",
    ]);
    expect(PUBLIC_ASSET_PREFIXES).toEqual(["/_next/static", "/_next/image", "/brand/"]);
    const matcherLine = Array.isArray(config.matcher) ? config.matcher[0] : config.matcher;
    expect(matcherLine).toBe(PROXY_MATCHER);
    expect(matcherLine).not.toMatch(/\.\*\??\\\.\(\?:svg/);
    expect(matcherLine).not.toMatch(/svg\|png\|jpg/);
    expect(matcherLine).toContain("brand/");
    expect(matcherLine).toContain("favicon\\.ico");
    expect(matcherLine).toContain("site\\.webmanifest");
  });

  it("matcher and isPublicAssetPath agree: session check skipped only for allowlisted assets", () => {
    const open = [
      "/brand/logo-full.svg",
      "/brand/logo-wordmark.svg",
      "/brand/icon-32.png",
      "/favicon.ico",
      "/icon.png",
      "/apple-icon.png",
      "/icon",
      "/apple-icon",
      "/site.webmanifest",
      "/_next/static/chunks/app.js",
      "/_next/image",
    ];
    for (const path of open) {
      expect(isPublicAssetPath(path), path).toBe(true);
      expect(shouldCheckSession(path), path).toBe(false);
      expect(matcherHits(path), `matcher should skip ${path}`).toBe(false);
    }

    const gated = [
      "/api/anything.png",
      "/api/x.svg",
      "/customers/foo.png",
      "/customers/photo.svg",
      "/files/attachments/1.png",
      "/login.png",
      "/evil.ico",
      "/site.webmanifest.bak",
      "/brand",
      "/customers",
      "/",
    ];
    for (const path of gated) {
      expect(isPublicAssetPath(path), path).toBe(false);
      expect(shouldCheckSession(path), path).toBe(true);
      expect(matcherHits(path), `matcher should hit ${path}`).toBe(true);
    }
  });

  it("logged out: /api/anything.png, /api/x.svg and /customers/foo.png still get the session redirect", () => {
    for (const path of ["/api/anything.png", "/api/x.svg", "/customers/foo.png"]) {
      expect(shouldCheckSession(path)).toBe(true);
      expect(matcherHits(path)).toBe(true);
      const res = proxy(loggedOut(`http://localhost${path}`));
      expect(res.status, path).toBe(307);
      expect(res.headers.get("location"), path).toBe("http://localhost/login");
    }
  });

  it("logged out: /brand logos, favicon, icons and manifest pass without a session", () => {
    for (const path of [
      "/brand/logo-full.svg",
      "/brand/logo-wordmark.svg",
      "/favicon.ico",
      "/icon.png",
      "/apple-icon.png",
      "/icon",
      "/apple-icon",
      "/site.webmanifest",
    ]) {
      expect(shouldCheckSession(path)).toBe(false);
      expect(matcherHits(path)).toBe(false);
      const res = proxy(loggedOut(`http://localhost${path}`));
      expect(res.status, path).toBe(200);
      // next() — no Location redirect
      expect(res.headers.get("location"), path).toBeNull();
    }
  });

  it("logged out: /files/* still 401 (unchanged)", () => {
    const res = proxy(loggedOut("http://localhost/files/business-documents/abc"));
    expect(res.status).toBe(401);
  });
});
