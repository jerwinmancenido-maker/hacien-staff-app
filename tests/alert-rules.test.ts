// Adoption item 8: email alert rules — settings shape, form parsing,
// snapshot pre-fill, recipient merging and the generic alert template.
// (The sending behaviour itself is proven in tests/db/alert-rules.db.test.ts.)

import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/settings/defaults";
import { settingsValueFromForm } from "@/lib/settings/form";
import { ALERT_EVENT_KEYS, settingsSections, type Settings } from "@/lib/settings/schema";
import {
  getSettingsSnapshot,
  saveSettingsSection,
  type SettingsStore,
  type SettingsVersionRecord,
} from "@/lib/settings/service";
import { staffAlertEmail } from "@/lib/email-templates";
import { mergeRecipients } from "@/lib/services/alerts";

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

describe("alert rule defaults", () => {
  it("every event starts enabled, email channel, Admins + Approvers, no extra addresses", () => {
    for (const key of ALERT_EVENT_KEYS) {
      expect(DEFAULT_SETTINGS.alerts[key]).toEqual({
        enabled: true,
        channel: "email",
        roles: ["admin", "approver"],
        emails: [],
      });
    }
  });

  it("the section schema rejects a bad address, an unknown role and a non-email channel", () => {
    const base = DEFAULT_SETTINGS.alerts;
    const badEmail = settingsSections.alerts.safeParse({
      ...base,
      collection: { ...base.collection, emails: ["not-an-email"] },
    });
    expect(badEmail.success).toBe(false);
    const badRole = settingsSections.alerts.safeParse({
      ...base,
      collection: { ...base.collection, roles: ["boss"] },
    });
    expect(badRole.success).toBe(false);
    const badChannel = settingsSections.alerts.safeParse({
      ...base,
      collection: { ...base.collection, channel: "telegram" },
    });
    expect(badChannel.success).toBe(false);
  });
});

describe("alerts form parsing", () => {
  it("builds the section value from the Settings form fields", () => {
    const fields = new Map<string, string>([
      ["goodsReceived.enabled", "true"],
      ["goodsReceived.role.admin", "true"],
      ["goodsReceived.role.approver", "true"],
      ["goodsReceived.emails", ""],
      ["supplierPayment.enabled", "false"],
      ["collection.enabled", "true"],
      ["collection.role.staff", "true"],
      ["collection.emails", "owner@example.com\n  second@example.com \n\n"],
      ["quoteApproved.enabled", "true"],
      ["quoteApproved.role.approver", "true"],
      ["salesOrderConfirmed.enabled", "true"],
      ["salesOrderConfirmed.role.admin", "true"],
      ["salesOrderConfirmed.role.staff", "true"],
    ]);
    const value = settingsValueFromForm("alerts", (name) => fields.get(name) ?? null) as Settings["alerts"];
    expect(value.goodsReceived).toEqual({ enabled: true, channel: "email", roles: ["admin", "approver"], emails: [] });
    expect(value.supplierPayment).toEqual({ enabled: false, channel: "email", roles: [], emails: [] });
    expect(value.collection).toEqual({
      enabled: true,
      channel: "email",
      roles: ["staff"],
      emails: ["owner@example.com", "second@example.com"],
    });
    expect(value.quoteApproved.roles).toEqual(["approver"]);
    expect(value.salesOrderConfirmed.roles).toEqual(["admin", "staff"]);
    // And the parsed value passes the section schema.
    expect(settingsSections.alerts.safeParse(value).success).toBe(true);
  });
});

describe("alerts snapshot pre-fill (no data migration)", () => {
  it("an old snapshot without the alerts section reads back with the defaults", async () => {
    const store = memoryStore();
    const v1 = await getSettingsSnapshot(store);
    const oldData = structuredClone(v1.settings) as unknown as Record<string, unknown>;
    delete oldData.alerts;
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
    expect(snap.settings.alerts).toEqual(DEFAULT_SETTINGS.alerts);
  });

  it("a partial snapshot merges per event over the defaults, and the section saves as a new version", async () => {
    const store = memoryStore();
    const v1 = await getSettingsSnapshot(store);
    const partial = structuredClone(v1.settings) as unknown as Record<string, unknown>;
    partial.alerts = { collection: { enabled: false } };
    await store.create({
      version: 2,
      data: partial as unknown as Settings,
      changedKey: null,
      before: null,
      after: null,
      createdById: null,
    });
    const snap = await getSettingsSnapshot(store);
    expect(snap.settings.alerts.collection.enabled).toBe(false);
    expect(snap.settings.alerts.collection.roles).toEqual(["admin", "approver"]);
    expect(snap.settings.alerts.goodsReceived).toEqual(DEFAULT_SETTINGS.alerts.goodsReceived);

    const res = await saveSettingsSection(store, {
      key: "alerts",
      value: { ...snap.settings.alerts, quoteApproved: { ...snap.settings.alerts.quoteApproved, enabled: false } },
      userId: "u1",
      baseVersionId: snap.versionId,
    });
    expect(res.ok).toBe(true);
    const after = await getSettingsSnapshot(store);
    expect(after.settings.alerts.quoteApproved.enabled).toBe(false);
    expect(after.settings.alerts.collection.enabled).toBe(false);
  });
});

describe("mergeRecipients", () => {
  it("de-dupes case-insensitively, keeps the first spelling and order", () => {
    expect(mergeRecipients(["Ana@x.com", "bob@x.com"], ["ana@X.com", "cy@x.com"])).toEqual([
      "Ana@x.com",
      "bob@x.com",
      "cy@x.com",
    ]);
    expect(mergeRecipients([], [])).toEqual([]);
  });
});

describe("staffAlertEmail", () => {
  it("renders subject, intro, lines and the view link in text and HTML, escaping values", () => {
    const mail = staffAlertEmail({
      subject: "Collection recorded — CR-2026-0001",
      heading: "Collection recorded",
      intro: "A collection from <b>Acme</b> was recorded.",
      lines: ["Amount received: ₱1,000.00"],
      url: "http://localhost:3000/billing/collections/abc",
      urlLabel: "View the collection",
    });
    expect(mail.subject).toBe("Collection recorded — CR-2026-0001");
    expect(mail.text).toContain("Amount received: ₱1,000.00");
    expect(mail.text).toContain("View the collection: http://localhost:3000/billing/collections/abc");
    expect(mail.html).toContain("&lt;b&gt;Acme&lt;/b&gt;");
    expect(mail.html).not.toContain("<b>Acme</b>");
  });
});
