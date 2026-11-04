import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isValidEmail, isValidPhMobile, maskPhMobile, maskRecipient, normalizePhMobile } from "@/lib/messaging/phone";
import { NOT_SET_UP, notConfiguredProvider } from "@/lib/messaging/providers";
import { retryMessage, sendMessage, type LogWriter } from "@/lib/messaging/send";

function memoryLog(): LogWriter & { rows: Record<string, { channel: "sms" | "email"; recipient: string; body: string; attempts: number; status: string }> } {
  const rows: Record<string, { channel: "sms" | "email"; recipient: string; body: string; attempts: number; status: string }> = {};
  let n = 0;
  return {
    rows,
    async create(data) {
      const id = `log-${++n}`;
      rows[id] = { channel: data.channel, recipient: data.recipient, body: data.body, attempts: 1, status: data.status };
      return { id };
    },
    async update(id, data) {
      rows[id]!.status = data.status;
      rows[id]!.attempts = data.attempts;
    },
    async find(id) {
      const row = rows[id];
      if (!row) return null;
      return { id, channel: row.channel, recipient: row.recipient, body: row.body, attempts: row.attempts };
    },
  };
}

describe("PH mobile check", () => {
  it("accepts 09, +63 and 63 forms and normalizes to +63", () => {
    expect(normalizePhMobile("09171234567")).toBe("+639171234567");
    expect(normalizePhMobile("+639171234567")).toBe("+639171234567");
    expect(normalizePhMobile("639171234567")).toBe("+639171234567");
    expect(normalizePhMobile("0917 123 4567")).toBe("+639171234567");
    expect(normalizePhMobile("0917-123-4567")).toBe("+639171234567");
  });
  it("rejects empty, letters, short, long and landline numbers", () => {
    for (const bad of ["", "abc", "0917123456", "091712345678", "028123456", "0917123456a", "+441234567890"]) {
      expect(isValidPhMobile(bad)).toBe(false);
      expect(normalizePhMobile(bad)).toBeNull();
    }
  });
});

describe("masking", () => {
  it("shows only the last 4 digits of a mobile", () => {
    expect(maskPhMobile("+639171234567")).toBe("+63******4567");
    expect(maskRecipient("sms", "09171234567")).toBe("+63******4567");
  });
  it("masks email local parts", () => {
    expect(maskRecipient("email", "juan@example.com")).toBe("j****@example.com");
  });
});

describe("providers", () => {
  it("not-configured provider logs the exact not-set-up reason and makes no request", async () => {
    const provider = notConfiguredProvider("UniSMS");
    await expect(provider.send({ to: "+639171234567", body: "hi" })).resolves.toEqual({
      ok: false,
      error: NOT_SET_UP,
    });
    expect(NOT_SET_UP).toBe("not sent: not set up");
  });
});

describe("sendMessage and retry", () => {
  it("logs not_sent when the provider is not set up, and retry re-attempts", async () => {
    const log = memoryLog();
    const sent = await sendMessage(
      { channel: "sms", to: "09171234567", body: "Order confirmed" },
      { provider: notConfiguredProvider("UniSMS"), log },
    );
    expect(sent.status).toBe("not_sent");
    const row = log.rows[sent.logId]!;
    expect(row.recipient).toBe("+639171234567");
    expect(row.attempts).toBe(1);
    const retried = await retryMessage(sent.logId, { provider: notConfiguredProvider("UniSMS"), log });
    expect(retried.status).toBe("not_sent");
    expect(log.rows[sent.logId]!.attempts).toBe(2);
  });
  it("rejects an invalid mobile and an invalid email, and an empty body", async () => {
    const log = memoryLog();
    const badSms = await sendMessage({ channel: "sms", to: "028123456", body: "hi" }, { provider: notConfiguredProvider("UniSMS"), log });
    expect(badSms.status).toBe("failed");
    const badEmail = await sendMessage({ channel: "email", to: "not-an-email", body: "hi" }, { provider: notConfiguredProvider("smtp"), log });
    expect(badEmail.status).toBe("failed");
    expect(isValidEmail("a@b.co")).toBe(true);
    expect(isValidEmail("no-at")).toBe(false);
    const empty = await sendMessage({ channel: "sms", to: "09171234567", body: "  " }, { provider: notConfiguredProvider("UniSMS"), log });
    expect(empty.status).toBe("failed");
  });
  it("records a sent message through a mock provider", async () => {
    const log = memoryLog();
    const result = await sendMessage(
      { channel: "email", to: "juan@example.com", body: "Hello" },
      { provider: { name: "mock", async send() { return { ok: true, providerMessageId: "m1" }; } }, log },
    );
    expect(result).toEqual({ ok: true, status: "sent", logId: result.logId });
    expect(log.rows[result.logId]!.status).toBe("sent");
  });
});

describe("messages page", () => {
  it("is Admin-only and only ever renders masked recipients", () => {
    const page = readFileSync(join(__dirname, "../src/app/(app)/messages/page.tsx"), "utf8");
    expect(page).toContain('requirePagePermission("manage_settings")');
    expect(page).toContain("maskRecipient(row.channel, row.recipient)");
    expect(page).not.toContain("row.recipient,");
  });
  it("sidebar has an Admin Messages link", () => {
    const sidebar = readFileSync(join(__dirname, "../src/components/Sidebar.tsx"), "utf8");
    expect(sidebar).toContain('href: "/messages"');
    expect(sidebar).toContain('messages: "Messages"');
  });
});
