import { describe, expect, it } from "vitest";
import { DB_CONNECTION_LIMIT, cappedDatasourceUrl } from "@/lib/db";

describe("cappedDatasourceUrl", () => {
  it("pins the cap at 5 connections per process", () => {
    expect(DB_CONNECTION_LIMIT).toBe(5);
  });

  it("appends the cap with ? when the URL has no query string", () => {
    expect(cappedDatasourceUrl("mysql://user:pass@dbhost:3306/hacien")).toBe(
      "mysql://user:pass@dbhost:3306/hacien?connection_limit=5",
    );
  });

  it("appends the cap with & when the URL already has parameters", () => {
    expect(cappedDatasourceUrl("mysql://user:pass@dbhost:3306/hacien?socket=/tmp/mysql.sock")).toBe(
      "mysql://user:pass@dbhost:3306/hacien?socket=/tmp/mysql.sock&connection_limit=5",
    );
  });

  it("leaves a URL that already sets connection_limit untouched", () => {
    const withQuestion = "mysql://user:pass@dbhost:3306/hacien?connection_limit=9";
    expect(cappedDatasourceUrl(withQuestion)).toBe(withQuestion);
    const withAmpersand = "mysql://user:pass@dbhost:3306/hacien?socket=/tmp/mysql.sock&connection_limit=9";
    expect(cappedDatasourceUrl(withAmpersand)).toBe(withAmpersand);
  });

  it("passes undefined through so a missing DATABASE_URL fails as before", () => {
    expect(cappedDatasourceUrl(undefined)).toBeUndefined();
  });
});
