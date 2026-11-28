// Adoption item 16: customer auto-emails — settings shape (defaults,
// form parsing, snapshot pre-fill) and the two customer email templates.
// (The sending behaviour itself is proven in
// tests/db/customer-emails.db.test.ts.)

import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/settings/defaults";
import { settingsValueFromForm } from "@/lib/settings/form";
import { settingsSections, type Settings } from "@/lib/settings/schema";
import {
  getSettingsSnapshot,
  saveSettingsSection,
  type SettingsStore,
  type SettingsVersionRecord,
} from "@/lib/settings/service";
import { customerDeliveryRecordedEmail, customerPaymentReceivedEmail } from "@/lib/email-templates";

/** In-memory store with the same contract as the Prisma one. */
function memoryStore(): SettingsStore & { rows: SettingsVersionRecord[] } {
  const rows: SettingsVersionRecord[] = [];
  let n = 0;
  return {
    rows,
    async latest() {
      return rows.reduce<SettingsVersionRecord | null>((a, r) => (!a || r.version > a.version ? r : a), null);
    },
    async byId(id) {
      return rows.find((r) => r.id === id) ?? null;
    },
    async create(input) {
      if (rows.some((r) => r.version === input.version)) throw new Error("unique version");
      const row = { ...structuredClone(input), id: `v${++n}`, effectiveFrom: new Date(Date.UTC(2026, 9, n)) };
      rows.push(row);
      return structuredClone(row);
    },
  };
}

describe("customer email toggles (features)", () => {
  it("both default ON — the item-5 automatic-email precedent", () => {
    expect(DEFAULT_SETTINGS.features.customerPaymentEmailEnabled).toBe(true);
    expect(DEFAULT_SETTINGS.features.customerDeliveryEmailEnabled).toBe(true);
  });

  it("an old features value without the new keys parses with both ON (no data migration)", () => {
    const old = { ...DEFAULT_SETTINGS.features } as Record<string, unknown>;
    delete old.customerPaymentEmailEnabled;
    delete old.customerDeliveryEmailEnabled;
    const parsed = settingsSections.features.safeParse(old);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.customerPaymentEmailEnabled).toBe(true);
      expect(parsed.data.customerDeliveryEmailEnabled).toBe(true);
    }
  });

  it("the Settings form parses both checkboxes and the value passes the schema", () => {
    const fields = new Map<string, string>([
      ["payablesEnabled", "false"],
      ["cashEnabled", "true"],
      ["booksEnabled", "false"],
      ["payables2307Enabled", "false"],
      ["warrantyClaimsEnabled", "false"],
      ["itemsImportEnabled", "false"],
      ["periodCloseEnabled", "false"],
      ["receivingEmailEnabled", "true"],
      ["customerPaymentEmailEnabled", "false"],
      ["customerDeliveryEmailEnabled", "true"],
    ]);
    const value = settingsValueFromForm("features", (name) => fields.get(name) ?? null) as Settings["features"];
    expect(value.customerPaymentEmailEnabled).toBe(false);
    expect(value.customerDeliveryEmailEnabled).toBe(true);
    expect(value.receivingEmailEnabled).toBe(true);
    expect(settingsSections.features.safeParse(value).success).toBe(true);
  });

  it("an old snapshot without the new keys reads back ON, and the section still saves", async () => {
    const store = memoryStore();
    const v1 = await getSettingsSnapshot(store);
    const oldData = structuredClone(v1.settings) as unknown as Record<string, unknown>;
    const features = { ...(oldData.features as Record<string, unknown>) };
    delete features.customerPaymentEmailEnabled;
    delete features.customerDeliveryEmailEnabled;
    oldData.features = features;
    await store.create({
      version: 2,
      data: oldData as unknown as Settings,
      changedKey: null,
      before: null,
      after: null,
      createdById: null,
    });
    const snap = await getSettingsSnapshot(store);
    expect(snap.version).toBe(2);
    expect(snap.settings.features.customerPaymentEmailEnabled).toBe(true);
    expect(snap.settings.features.customerDeliveryEmailEnabled).toBe(true);

    const res = await saveSettingsSection(store, {
      key: "features",
      value: { ...snap.settings.features, customerDeliveryEmailEnabled: false },
      userId: "u1",
      baseVersionId: snap.versionId,
    });
    expect(res.ok).toBe(true);
    const after = await getSettingsSnapshot(store);
    expect(after.settings.features.customerDeliveryEmailEnabled).toBe(false);
    expect(after.settings.features.customerPaymentEmailEnabled).toBe(true);
  });
});

const paymentBase = {
  customerName: "Acme Corp",
  billingNumber: "BL-2026-0007",
  salesOrderNumber: "SO-2026-0004",
  collectionNumber: "COL-2026-0011",
  collectionDateLabel: "28 Nov 2026",
  cashApplied: "400.00",
  withholdingApplied: "0.00",
  appliedTotal: "400.00",
  balance: "600.00",
  paidInFull: false,
};

describe("customerPaymentReceivedEmail", () => {
  it("part payment: applied amount + remaining balance, no withholding lines, no app link", () => {
    const mail = customerPaymentReceivedEmail(paymentBase);
    expect(mail.subject).toBe("Payment received — BL-2026-0007");
    expect(mail.text).toContain("Good day, Acme Corp,");
    expect(mail.text).toContain("billing BL-2026-0007 (sales order SO-2026-0004)");
    expect(mail.text).toContain("Amount applied to this billing: ₱400.00");
    expect(mail.text).not.toContain("withholding tax");
    expect(mail.text).toContain("Remaining balance on this billing: ₱600.00");
    expect(mail.text).toContain("just reply to this email");
    // Customers have no staff login — the email must carry no app link.
    expect(mail.text).not.toContain("http");
    expect(mail.html).not.toContain("<a href");
    expect(mail.html).not.toContain("STAFF APP");
  });

  it("paid in full: says so, and shows no remaining balance", () => {
    const mail = customerPaymentReceivedEmail({ ...paymentBase, cashApplied: "1000.00", appliedTotal: "1000.00", balance: "0.00", paidInFull: true });
    expect(mail.text).toContain("This billing is now paid in full.");
    expect(mail.text).not.toContain("Remaining balance");
  });

  it("withholding: the breakdown names cash and Form 2307 withholding in plain words", () => {
    const mail = customerPaymentReceivedEmail({
      ...paymentBase,
      cashApplied: "880.00",
      withholdingApplied: "120.00",
      appliedTotal: "1000.00",
      balance: "0.00",
      paidInFull: true,
    });
    expect(mail.text).toContain("Amount applied to this billing: ₱1,000.00");
    expect(mail.text).toContain("Received in cash: ₱880.00");
    expect(mail.text).toContain("Covered by withholding tax (Form 2307): ₱120.00");
    expect(mail.html).toContain("Covered by withholding tax (Form 2307)");
  });

  it("escapes the customer name in the HTML version", () => {
    const mail = customerPaymentReceivedEmail({ ...paymentBase, customerName: "A <b>Corp</b>" });
    expect(mail.html).toContain("A &lt;b&gt;Corp&lt;/b&gt;");
    expect(mail.html).not.toContain("Good day, A <b>Corp</b>,");
  });
});

const deliveryBase = {
  customerName: "Acme Corp",
  salesOrderNumber: "SO-2026-0004",
  drNumber: "000123",
  deliveryDateLabel: "28 Nov 2026",
  receivedByName: "Juan Dela Cruz",
  lines: [{ title: "Widget A", unit: "pc", qty: "6.00" }],
  remaining: [{ title: "Widget A", unit: "pc", qtyRemaining: "4.00" }],
  fullyDelivered: false,
};

describe("customerDeliveryRecordedEmail", () => {
  it("partial delivery: DR number, lines delivered this time, what remains, no app link", () => {
    const mail = customerDeliveryRecordedEmail(deliveryBase);
    expect(mail.subject).toBe("Delivery recorded — SO-2026-0004");
    expect(mail.text).toContain("Good day, Acme Corp,");
    expect(mail.text).toContain("Delivery receipt: 000123 · Date: 28 Nov 2026");
    expect(mail.text).toContain("Received by: Juan Dela Cruz");
    expect(mail.text).toContain("- Widget A — 6 pc");
    expect(mail.text).toContain("Still to deliver:");
    expect(mail.text).toContain("- Widget A — 4 pc still to deliver");
    expect(mail.text).not.toContain("http");
    expect(mail.html).not.toContain("<a href");
    expect(mail.html).not.toContain("STAFF APP");
  });

  it("completing delivery: says the order is complete, no remaining section", () => {
    const mail = customerDeliveryRecordedEmail({
      ...deliveryBase,
      lines: [{ title: "Widget A", unit: "pc", qty: "4.00" }],
      remaining: [],
      fullyDelivered: true,
    });
    expect(mail.text).toContain("This completes your order — everything on SO-2026-0004 has now been delivered.");
    expect(mail.text).not.toContain("Still to deliver:");
  });

  it("no receiver recorded: the Received-by line is omitted", () => {
    const mail = customerDeliveryRecordedEmail({ ...deliveryBase, receivedByName: null });
    expect(mail.text).not.toContain("Received by:");
    expect(mail.html).not.toContain("Received by:");
  });
});
