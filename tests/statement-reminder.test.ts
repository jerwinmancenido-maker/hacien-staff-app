import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DUPLICATE_WINDOW_MS,
  buildStatementReminder,
  emailConfigured,
  isDuplicateSend,
  sanitizeHeaderValue,
} from "@/lib/services/statement-reminder";

// Phase 3 #9 — statement / payment reminder (scenarios E1–E3 + the
// header-injection security line from the master plan §7).

describe("E1 config check", () => {
  it("is configured only when SMTP_HOST is set and non-blank", () => {
    expect(emailConfigured({})).toBe(false);
    expect(emailConfigured({ SMTP_HOST: "" })).toBe(false);
    expect(emailConfigured({ SMTP_HOST: "   " })).toBe(false);
    expect(emailConfigured({ SMTP_HOST: "smtp.example" })).toBe(true);
  });

  it("the service checks configuration before touching the database", () => {
    const src = readFileSync("src/lib/services/statement-reminder.ts", "utf8");
    const configAt = src.indexOf("emailConfigured()");
    const statementAt = src.indexOf("getStatement(customerId");
    expect(configAt).toBeGreaterThan(-1);
    expect(statementAt).toBeGreaterThan(configAt);
    // Not-configured returns before any sent-record write exists in the flow.
    expect(src.indexOf("statementReminderSend.create")).toBeGreaterThan(statementAt);
  });

  it("the customer screen shows the not-configured state with no send button", () => {
    const src = readFileSync("src/components/billing/StatementReminderForm.tsx", "utf8");
    expect(src).toContain("Email is not configured on this server");
    // The button only exists in the configured + recipient branch.
    expect(src.indexOf("Email is not configured")).toBeLessThan(src.indexOf("Email statement to"));
  });
});

describe("header-injection safety", () => {
  it("strips CR/LF from values placed in mail headers", () => {
    expect(sanitizeHeaderValue("Acme\r\nBcc: x@example.com")).toBe("Acme Bcc: x@example.com");
    expect(sanitizeHeaderValue("  A\nB  ")).toBe("A B");
  });

  it("a crafted customer name cannot inject a header through the subject", () => {
    const draft = buildStatementReminder({
      customerName: "Acme\r\nBcc: victim@example.com",
      companyName: "HACIEN",
      closingBalance: "1000.00",
      overdue: "0",
      from: null,
      to: null,
      asOf: new Date("2026-11-14T00:00:00.000Z"),
    });
    expect(draft.subject).not.toMatch(/[\r\n]/);
    expect(draft.subject).toContain("Statement of account — Acme Bcc: victim@example.com");
  });
});

describe("E2 reminder wording and figures (D2, decided by Muse)", () => {
  const base = {
    customerName: "Sample Corp",
    companyName: "Hacien Solutions",
    closingBalance: "12345.50",
    overdue: "2000",
    from: null,
    to: null,
    asOf: new Date("2026-11-14T00:00:00.000Z"),
  };

  it("states the balance due, the overdue amount and the all-time period", () => {
    const draft = buildStatementReminder(base);
    expect(draft.text).toContain("Balance due: ₱12,345.50");
    expect(draft.text).toContain("Overdue: ₱2,000.00");
    expect(draft.text).toContain("Period covered: All transactions to date");
    expect(draft.text).toContain("please disregard this note");
    expect(draft.text).toContain("Hacien Solutions");
  });

  it("omits the overdue line when nothing is overdue, and prints a date range when given", () => {
    const draft = buildStatementReminder({ ...base, overdue: "0", from: "2026-10-01", to: "2026-10-31" });
    expect(draft.text).not.toContain("Overdue:");
    expect(draft.text).toContain("Period covered: 2026-10-01 to 2026-10-31");
  });

  it("the figures come from getStatement — the same source as the printed statement", () => {
    const src = readFileSync("src/lib/services/statement-reminder.ts", "utf8");
    expect(src).toContain('getStatement(customerId, period.from, period.to)');
    expect(src).toContain("stmt.closingBalance");
  });
});

describe("E3 duplicate guard", () => {
  const now = new Date("2026-11-14T01:00:00.000Z");

  it("blocks a repeat inside the window and allows one after it", () => {
    expect(isDuplicateSend({ sentAt: new Date(now.getTime() - 60_000) }, now)).toBe(true);
    expect(isDuplicateSend({ sentAt: new Date(now.getTime() - DUPLICATE_WINDOW_MS - 1) }, now)).toBe(false);
    expect(isDuplicateSend(null, now)).toBe(false);
  });

  it("the guard is enforced server-side against the sent-record table", () => {
    const src = readFileSync("src/lib/services/statement-reminder.ts", "utf8");
    expect(src).toContain("db.statementReminderSend.findFirst");
    expect(src).toContain('reason: "duplicate"');
    // A successful send writes the record and the audit row in one transaction.
    expect(src).toContain("db.$transaction");
    expect(src).toContain('action: "send_email"');
  });
});

describe("schema + migration (additive only)", () => {
  it("adds the StatementReminderSend table and appends the send_email audit action", () => {
    const sql = readFileSync(
      "prisma/migrations/20261114020000_statement_reminder_sends/migration.sql",
      "utf8",
    );
    expect(sql).toContain("CREATE TABLE `StatementReminderSend`");
    expect(sql).toContain("'delete', 'send_email'");
    expect(sql).not.toMatch(/DROP TABLE|DELETE FROM/);
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    expect(schema).toContain("model StatementReminderSend");
  });
});
