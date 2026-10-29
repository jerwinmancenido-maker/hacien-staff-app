import { describe, expect, it } from "vitest";
import { clientIp, DEFAULT_TRUSTED_PROXY_COUNT, trustedProxyCount } from "@/lib/auth/client-ip";
import { isLoginBlocked, MAX_FAILED_LOGINS, MAX_FAILED_LOGINS_PER_EMAIL, type IpAttempt } from "@/lib/auth/rate-limit";
import { cookieSecure } from "@/lib/auth/session";

const headers = (h: Record<string, string>) => new Headers(h);

describe("client IP from X-Forwarded-For", () => {
  it("uses the proxy-appended last address, not the client-supplied first one", () => {
    // Attacker sends "X-Forwarded-For: 1.2.3.4"; our proxy appends the real address.
    expect(clientIp(headers({ "x-forwarded-for": "1.2.3.4, 203.0.113.9" }), 1)).toBe("203.0.113.9");
    expect(clientIp(headers({ "x-forwarded-for": "203.0.113.9" }), 1)).toBe("203.0.113.9");
  });

  it("rotating the forged first value doesn't change the IP", () => {
    const ips = ["1.1.1.1", "2.2.2.2", "3.3.3.3"].map((fake) => clientIp(headers({ "x-forwarded-for": `${fake}, 198.51.100.7` }), 1));
    expect(new Set(ips)).toEqual(new Set(["198.51.100.7"]));
  });

  it("with N trusted proxies, takes the Nth address from the right", () => {
    const h = headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9, 10.0.0.2" });
    expect(clientIp(h, 2)).toBe("203.0.113.9");
    // Fewer entries than proxies: the leftmost one came from our side.
    expect(clientIp(headers({ "x-forwarded-for": "203.0.113.9" }), 3)).toBe("203.0.113.9");
  });

  it("ignores forwarding headers when no proxy is trusted, and never trusts X-Real-IP", () => {
    expect(clientIp(headers({ "x-forwarded-for": "6.6.6.6", "x-real-ip": "7.7.7.7" }), 0)).toBe("unknown");
    expect(clientIp(headers({ "x-real-ip": "7.7.7.7" }), 1)).toBe("unknown");
    expect(clientIp(headers({}), 1)).toBe("unknown");
  });

  it("reads TRUSTED_PROXY_COUNT, falling back to the default on bad values", () => {
    expect(trustedProxyCount(undefined)).toBe(DEFAULT_TRUSTED_PROXY_COUNT);
    expect(trustedProxyCount("")).toBe(DEFAULT_TRUSTED_PROXY_COUNT);
    expect(trustedProxyCount("2")).toBe(2);
    expect(trustedProxyCount("0")).toBe(0);
    expect(trustedProxyCount("-1")).toBe(DEFAULT_TRUSTED_PROXY_COUNT);
    expect(trustedProxyCount("abc")).toBe(DEFAULT_TRUSTED_PROXY_COUNT);
  });
});

describe("login rate limit per email + IP and per email", () => {
  const now = new Date("2026-10-30T00:15:00Z");
  const fail = (ip: string, minAgo = 1): IpAttempt => ({ ip, success: false, createdAt: new Date(now.getTime() - minAgo * 60_000) });

  it(`blocks one IP after ${MAX_FAILED_LOGINS} failures without blocking other IPs`, () => {
    const attempts = Array.from({ length: MAX_FAILED_LOGINS }, () => fail("203.0.113.9"));
    expect(isLoginBlocked(attempts, "203.0.113.9", now)).toBe(true);
    expect(isLoginBlocked(attempts, "198.51.100.7", now)).toBe(false);
  });

  it(`caps failures for one email at ${MAX_FAILED_LOGINS_PER_EMAIL} across all IPs`, () => {
    // An attacker spreading guesses over many IPs, each under the per-IP limit.
    const spread = (n: number) => Array.from({ length: n }, (_, i) => fail(`10.0.${Math.floor(i / 4)}.${i % 4}`));
    expect(isLoginBlocked(spread(MAX_FAILED_LOGINS_PER_EMAIL - 1), "192.0.2.1", now)).toBe(false);
    expect(isLoginBlocked(spread(MAX_FAILED_LOGINS_PER_EMAIL), "192.0.2.1", now)).toBe(true);
  });

  it("a successful sign-in and the 15-minute window both reset the per-email cap", () => {
    const many = Array.from({ length: MAX_FAILED_LOGINS_PER_EMAIL }, (_, i) => fail(`10.1.0.${i}`, 10));
    expect(isLoginBlocked([...many, { ip: "10.9.9.9", success: true, createdAt: new Date(now.getTime() - 5 * 60_000) }], "192.0.2.1", now)).toBe(false);
    const old = Array.from({ length: MAX_FAILED_LOGINS_PER_EMAIL }, (_, i) => fail(`10.1.0.${i}`, 20));
    expect(isLoginBlocked(old, "192.0.2.1", now)).toBe(false);
  });
});

describe("session cookie secure flag", () => {
  it("is secure in production or when APP_URL is https", () => {
    expect(cookieSecure({ NODE_ENV: "production", APP_URL: "http://localhost:3000" })).toBe(true);
    expect(cookieSecure({ NODE_ENV: "development", APP_URL: "https://staff.example.com" })).toBe(true);
    expect(cookieSecure({ NODE_ENV: "development", APP_URL: "HTTPS://staff.example.com" })).toBe(true);
  });

  it("is not secure for plain http in development", () => {
    expect(cookieSecure({ NODE_ENV: "development", APP_URL: "http://localhost:3000" })).toBe(false);
    expect(cookieSecure({ NODE_ENV: "test" })).toBe(false);
  });
});
