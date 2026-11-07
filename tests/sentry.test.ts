// Sentry scrub + gating: no DSN means no events, and no secret ever leaves
// the app in an event. Pure-function tests — no database needed.

import type { ErrorEvent } from "@sentry/nextjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sentryBeforeSend, sentryEnvironment } from "@/lib/sentry";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sentryBeforeSend", () => {
  it("strips request bodies, cookies and auth headers, keeps the rest", () => {
    const event = {
      request: {
        url: "https://staging-app.haciensolutions.com/login",
        method: "POST",
        data: { email: "a@example.com", password: "secret", tin: "123-456-789-000" },
        cookies: { hacien_session: "abc123" },
        headers: {
          Authorization: "Bearer secret-token",
          Cookie: "hacien_session=abc123",
          "content-type": "application/json",
        },
      },
    } as unknown as ErrorEvent;
    const out = sentryBeforeSend(event);
    expect(out).not.toBeNull();
    expect(out?.request?.data).toBeUndefined();
    expect(out?.request?.cookies).toBeUndefined();
    expect(out?.request?.headers?.Authorization).toBeUndefined();
    expect(out?.request?.headers?.Cookie).toBeUndefined();
    expect(out?.request?.headers?.["content-type"]).toBe("application/json");
    expect(out?.request?.url).toBe("https://staging-app.haciensolutions.com/login");
    expect(out?.request?.method).toBe("POST");
  });

  it("leaves events without a request untouched", () => {
    const event = { message: "boom" } as ErrorEvent;
    expect(sentryBeforeSend(event)).toBe(event);
  });
});

describe("sentryEnvironment", () => {
  it("prefers SENTRY_ENVIRONMENT on the server", () => {
    vi.stubEnv("SENTRY_ENVIRONMENT", "staging");
    vi.stubEnv("NEXT_PUBLIC_SENTRY_ENVIRONMENT", "production");
    expect(sentryEnvironment()).toBe("staging");
  });

  it("falls back to the public var in the browser build", () => {
    vi.stubEnv("SENTRY_ENVIRONMENT", "");
    vi.stubEnv("NEXT_PUBLIC_SENTRY_ENVIRONMENT", "staging");
    expect(sentryEnvironment()).toBe("staging");
  });

  it("is undefined when neither is set (SDK defaults to production)", () => {
    vi.stubEnv("SENTRY_ENVIRONMENT", "");
    vi.stubEnv("NEXT_PUBLIC_SENTRY_ENVIRONMENT", "");
    expect(sentryEnvironment()).toBeUndefined();
  });
});

describe("Sentry stays off without a DSN", () => {
  it("server and client configs initialise no client", async () => {
    delete process.env.SENTRY_DSN;
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    await import("../sentry.server.config");
    await import("../sentry.edge.config");
    await import("../instrumentation-client");
    const Sentry = await import("@sentry/nextjs");
    expect(Sentry.getClient()).toBeUndefined();
  });
});
