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
    const raw = pattern.startsWith("/") ? pattern.slice(1) : pattern;
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
    // /icon and /apple-icon only — app/icon.png and app/apple-icon.png are file
    // conventions served at those bare paths; there is no public/*.png for them.
    expect(PUBLIC_ASSET_EXACT).toEqual(["/favicon.ico", "/icon", "/apple-icon", "/site.webmanifest"]);
    expect(PUBLIC_ASSET_PREFIXES).toEqual(["/_next/static", "/_next/image", "/brand/"]);
    const matcherLine = Array.isArray(config.matcher) ? config.matcher[0] : config.matcher;
    expect(matcherLine).toBe(PROXY_MATCHER);
    expect(matcherLine).not.toMatch(/\.\*\??\\\.\(\?:svg/);
    expect(matcherLine).not.toMatch(/svg\|png\|jpg/);
    expect(matcherLine).toContain("brand/");
    expect(matcherLine).toContain("favicon\\.ico$");
    expect(matcherLine).toContain("icon$");
    expect(matcherLine).toContain("apple-icon$");
    expect(matcherLine).toContain("site\\.webmanifest$");
    // No unanchored (?:/|$) — trailing segments must stay gated.
    expect(matcherLine).not.toMatch(/favicon\\.ico\(\?:/);
    expect(matcherLine).not.toMatch(/site\\.webmanifest\(\?:/);
  });

  it("matcher and isPublicAssetPath agree: session check skipped only for allowlisted assets", () => {
    const open = [
      "/brand/logo-full.svg",
      "/brand/logo-wordmark.svg",
      "/brand/icon-32.png",
      "/favicon.ico",
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
      "/icon.png",
      "/apple-icon.png",
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

  it("logged out: trailing segments under favicon/icon/manifest stay gated", () => {
    for (const path of ["/favicon.ico/anything", "/icon/x", "/site.webmanifest/x", "/apple-icon/180"]) {
      expect(isPublicAssetPath(path), path).toBe(false);
      expect(shouldCheckSession(path), path).toBe(true);
      expect(matcherHits(path), `matcher should hit ${path}`).toBe(true);
      const res = proxy(loggedOut(`http://localhost${path}`));
      expect(res.status, path).toBe(307);
      expect(res.headers.get("location"), path).toBe("http://localhost/login");
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
      "/icon",
      "/apple-icon",
      "/site.webmanifest",
    ]) {
      expect(shouldCheckSession(path)).toBe(false);
      expect(matcherHits(path)).toBe(false);
      const res = proxy(loggedOut(`http://localhost${path}`));
      expect(res.status, path).toBe(200);
      expect(res.headers.get("location"), path).toBeNull();
    }
  });

  it("logged out: /files/* still 401 (unchanged)", () => {
    const res = proxy(loggedOut("http://localhost/files/business-documents/abc"));
    expect(res.status).toBe(401);
  });
});
