// B-1: the JSON request-error log line. It must stay parseable, carry the
// digest (so a staff screenshot of the error screen can be matched to the
// log), surface a Prisma-style error code when the error has one, and
// truncate long messages.

import { describe, expect, it } from "vitest";

import { requestErrorLogLine } from "../src/lib/request-error-log";

describe("requestErrorLogLine", () => {
  it("emits one parseable JSON line with route, digest, code and message", () => {
    const err = Object.assign(new Error("Can't reach database server"), {
      digest: "NEXT-123",
      code: "P1001",
    });
    const parsed = JSON.parse(requestErrorLogLine(err, "/")) as Record<
      string,
      unknown
    >;
    expect(parsed.level).toBe("error");
    expect(parsed.kind).toBe("request_error");
    expect(parsed.route).toBe("/");
    expect(parsed.digest).toBe("NEXT-123");
    expect(parsed.code).toBe("P1001");
    expect(parsed.message).toBe("Can't reach database server");
  });

  it("uses nulls when the error carries no digest or code", () => {
    const parsed = JSON.parse(
      requestErrorLogLine(new Error("plain"), undefined),
    ) as Record<string, unknown>;
    expect(parsed.route).toBeNull();
    expect(parsed.digest).toBeNull();
    expect(parsed.code).toBeNull();
    expect(parsed.message).toBe("plain");
  });

  it("handles non-Error values and truncates long messages", () => {
    const parsed = JSON.parse(
      requestErrorLogLine("x".repeat(900), "/login"),
    ) as Record<string, unknown>;
    expect(parsed.route).toBe("/login");
    expect(String(parsed.message)).toHaveLength(500);
  });
});
