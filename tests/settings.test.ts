import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/format";
import { DEFAULT_SETTINGS } from "@/lib/settings/defaults";
import { formatDocNumber } from "@/lib/settings/numbering";
import { changedLeaves, settingsValueFromForm } from "@/lib/settings/form";
import {
  getSettingsSnapshot,
  getSettingsVersion,
  saveSettingsSection,
  SettingsConflictError,
  type SettingsStore,
  type SettingsVersionRecord,
} from "@/lib/settings/service";
import {
  BILLING_DISCLAIMER,
  EWT_2307_NOTE,
  INPUT_TAX_DISCLAIMER,
  NON_VAT_LABEL,
  PACKING_LIST_DISCLAIMER,
  QUOTATION_NOT_INVOICE,
  SALES_ORDER_NOT_INVOICE,
  THANK_YOU,
} from "@/lib/print/tax-wording";
import {
  COD_POINT2_TEXT,
  QUOTE_SO_TERMS_POINT_4,
  QUOTE_SO_TERMS_POINT_6,
  QUOTE_SO_TERMS_POINT_7,
  TERMS_AND_CONDITIONS_HEADING,
  quoteSoTermsPoint1,
  quoteSoTermsPoint2,
  quoteSoTermsPoint3,
  quoteSoTermsPoint5,
} from "@/lib/print/terms-block";
import { POLICIES_DISPLAY_HOST, POLICIES_URL, POLICY_VERSION_LINE } from "@/lib/print/policies";
import { settingsSections, PAYMENT_TERM_PRESET_SEED, type Settings } from "@/lib/settings/schema";

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
      // Store a deep copy, like a database would.
      const row = { ...structuredClone(input), id: `v${++n}`, effectiveFrom: new Date(Date.UTC(2026, 9, n)) };
      rows.push(row);
      return structuredClone(row);
    },
  };
}

describe("settings defaults", () => {
  it("seeds the agreed defaults", () => {
    expect(DEFAULT_SETTINGS.approval).toEqual({ marginBelowPct: 18, totalAbove: 500000, poTotalAbove: 100000 });
    expect(DEFAULT_SETTINGS.quotes.defaultValidityDays).toBe(15);
    // New quotes with no validity date use this default (Nov 2 + 15 days).
    const nov2 = new Date("2026-11-02T00:00:00.000Z");
    expect(addDays(nov2, DEFAULT_SETTINGS.quotes.defaultValidityDays).toISOString().slice(0, 10)).toBe("2026-11-17");
    expect(DEFAULT_SETTINGS.taxYear).toMatchObject({
      year: 2026,
      nonVatLimit: 3000000,
      warnFirstPct: 70,
      warnSecondPct: 90,
      incomeTaxMethod: "EIGHT_PERCENT",
      booksType: null,
    });
    expect(DEFAULT_SETTINGS.taxYear.incomeTaxMethodsByYear["2026"]).toBe("EIGHT_PERCENT");
    expect(DEFAULT_SETTINGS.taxYear.holidays.length).toBe(20);
    const y = DEFAULT_SETTINGS.taxYear.year;
    expect(formatDocNumber(DEFAULT_SETTINGS.numbering.quote, y, 1)).toBe("QT-2026-0001");
    expect(formatDocNumber(DEFAULT_SETTINGS.numbering.salesOrder, y, 1)).toBe("SO-2026-0001");
    expect(formatDocNumber(DEFAULT_SETTINGS.numbering.supplierPo, y, 12)).toBe("PO-2026-0012");
  });
});

describe("settings versioning", () => {
  it("creates version 1 from defaults when empty", async () => {
    const store = memoryStore();
    const snap = await getSettingsSnapshot(store);
    expect(snap.version).toBe(1);
    expect(snap.settings).toEqual(DEFAULT_SETTINGS);
    expect(store.rows).toHaveLength(1);
  });

  it("each save creates a new version with who, old and new", async () => {
    const store = memoryStore();
    const v1 = await getSettingsSnapshot(store);
    const res = await saveSettingsSection(store, {
      key: "approval",
      value: { marginBelowPct: "20", totalAbove: "750000", poTotalAbove: "100000" },
      userId: "jerwin",
      baseVersionId: v1.versionId,
    });
    expect(res.ok && res.changed).toBe(true);
    if (!res.ok) throw new Error("expected ok");
    expect(res.version.version).toBe(2);
    expect(res.version.createdById).toBe("jerwin");
    expect(res.version.changedKey).toBe("approval");
    expect(res.version.before).toEqual({ marginBelowPct: 18, totalAbove: 500000, poTotalAbove: 100000 });
    expect(res.version.after).toEqual({ marginBelowPct: 20, totalAbove: 750000, poTotalAbove: 100000 });
    expect(store.rows).toHaveLength(2);
  });

  it("keeps an old version readable and unchanged after a change", async () => {
    const store = memoryStore();
    const v1 = await getSettingsSnapshot(store);
    // A document created now would store v1.versionId.
    const documentSettingsVersionId = v1.versionId;

    await saveSettingsSection(store, {
      key: "approval",
      value: { marginBelowPct: 25, totalAbove: 1_000_000 },
      userId: "jerwin",
      baseVersionId: v1.versionId,
    });

    const current = await getSettingsSnapshot(store);
    expect(current.version).toBe(2);
    expect(current.settings.approval.marginBelowPct).toBe(25);

    const old = await getSettingsVersion(store, documentSettingsVersionId);
    expect(old?.version).toBe(1);
    expect(old?.settings.approval).toEqual({ marginBelowPct: 18, totalAbove: 500000, poTotalAbove: 100000 });
    // Untouched sections are carried forward into the new version.
    expect(current.settings.numbering).toEqual(old?.settings.numbering);
  });

  it("rejects a save based on an outdated version", async () => {
    const store = memoryStore();
    const v1 = await getSettingsSnapshot(store);
    await saveSettingsSection(store, { key: "quotes", value: { defaultValidityDays: 20 }, userId: "a", baseVersionId: v1.versionId });
    await expect(
      saveSettingsSection(store, { key: "quotes", value: { defaultValidityDays: 45 }, userId: "b", baseVersionId: v1.versionId }),
    ).rejects.toBeInstanceOf(SettingsConflictError);
  });

  it("maps SettingsVersion_version_key unique race (P2002) to SettingsConflictError", async () => {
    const { Prisma } = await import("@prisma/client");
    const store = memoryStore();
    const v1 = await getSettingsSnapshot(store);
    const original = store.create.bind(store);
    store.create = async () => {
      // Simulate the MySQL unique index winning after the optimistic versionId check.
      throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the constraint: `SettingsVersion_version_key`", {
        code: "P2002",
        clientVersion: "test",
        meta: { modelName: "SettingsVersion", target: ["version"] },
      });
    };
    const err = await saveSettingsSection(store, {
      key: "quotes",
      value: { defaultValidityDays: 20 },
      userId: "a",
      baseVersionId: v1.versionId,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(SettingsConflictError);
    expect(err.message).toBe("Settings were changed by someone else. Reload the page and try again.");
    store.create = original;
  });

  it("returns field errors and saves nothing for invalid input", async () => {
    const store = memoryStore();
    const v1 = await getSettingsSnapshot(store);
    const res = await saveSettingsSection(store, {
      key: "taxYear",
      value: { year: 2026, nonVatLimit: 3000000, warnFirstPct: 95, warnSecondPct: 90 },
      userId: "a",
      baseVersionId: v1.versionId,
    });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected errors");
    expect(res.fieldErrors.warnSecondPct).toMatch(/lower/);
    expect(store.rows).toHaveLength(1);
  });

  it("does not create a version when nothing changed", async () => {
    const store = memoryStore();
    const v1 = await getSettingsSnapshot(store);
    const res = await saveSettingsSection(store, { key: "quotes", value: { defaultValidityDays: "15" }, userId: "a", baseVersionId: v1.versionId });
    expect(res.ok && !res.changed).toBe(true);
    expect(store.rows).toHaveLength(1);
  });

  it("round-trips 2551Q dueMonth set and empty through save then read", async () => {
    const store = memoryStore();
    const v1 = await getSettingsSnapshot(store);
    const withMonth = {
      ...v1.settings.taxCalendar,
      obligations: {
        ...v1.settings.taxCalendar.obligations,
        "2551q": { enabled: true, dueDay: null, dueMonth: 6 },
      },
    };
    const saveSet = await saveSettingsSection(store, {
      key: "taxCalendar",
      value: withMonth,
      userId: "a",
      baseVersionId: v1.versionId,
    });
    expect(saveSet.ok && saveSet.changed).toBe(true);
    const afterSet = await getSettingsSnapshot(store);
    expect(afterSet.settings.taxCalendar.obligations["2551q"].dueMonth).toBe(6);
    expect(afterSet.settings.taxCalendar.obligations["2551q"].dueDay).toBeNull();

    const cleared = {
      ...afterSet.settings.taxCalendar,
      obligations: {
        ...afterSet.settings.taxCalendar.obligations,
        "2551q": { enabled: true, dueDay: null, dueMonth: null },
      },
    };
    const saveClear = await saveSettingsSection(store, {
      key: "taxCalendar",
      value: cleared,
      userId: "a",
      baseVersionId: afterSet.versionId,
    });
    expect(saveClear.ok && saveClear.changed).toBe(true);
    const afterClear = await getSettingsSnapshot(store);
    expect(afterClear.settings.taxCalendar.obligations["2551q"].dueMonth).toBeNull();
  });

  it("regression: reading a stored 2551q.dueMonth must not wipe it (failed on main)", async () => {
    const store = memoryStore();
    const v1 = await getSettingsSnapshot(store);
    // Simulate a prior save that wrote dueMonth into the version JSON (as main does).
    await store.create({
      version: 2,
      data: {
        ...v1.settings,
        taxCalendar: {
          ...v1.settings.taxCalendar,
          obligations: {
            ...v1.settings.taxCalendar.obligations,
            "2551q": { enabled: true, dueDay: 15, dueMonth: 3 },
          },
        },
      },
      changedKey: "taxCalendar",
      before: v1.settings.taxCalendar,
      after: null,
      createdById: "a",
    });
    const snap = await getSettingsSnapshot(store);
    // Stale dueDay is still migrated away; dueMonth must survive the read path.
    expect(snap.settings.taxCalendar.obligations["2551q"].dueDay).toBeNull();
    expect(snap.settings.taxCalendar.obligations["2551q"].dueMonth).toBe(3);
  });

  it("round-trips a custom 2551q dueDay through save then read", async () => {
    const store = memoryStore();
    const v1 = await getSettingsSnapshot(store);
    const withDay = {
      ...v1.settings.taxCalendar,
      obligations: {
        ...v1.settings.taxCalendar.obligations,
        "2551q": { enabled: true, dueDay: 20, dueMonth: null },
      },
    };
    const res = await saveSettingsSection(store, {
      key: "taxCalendar",
      value: withDay,
      userId: "a",
      baseVersionId: v1.versionId,
    });
    expect(res.ok && res.changed).toBe(true);
    const snap = await getSettingsSnapshot(store);
    expect(snap.settings.taxCalendar.obligations["2551q"].dueDay).toBe(20);
    expect(snap.settings.taxCalendar.obligations["2551q"].dueMonth).toBeNull();
  });

  it("regression: stored 2551q.dueDay 15 still clears on read", async () => {
    const store = memoryStore();
    const v1 = await getSettingsSnapshot(store);
    await store.create({
      version: 2,
      data: {
        ...v1.settings,
        taxCalendar: {
          ...v1.settings.taxCalendar,
          obligations: {
            ...v1.settings.taxCalendar.obligations,
            "2551q": { enabled: true, dueDay: 15, dueMonth: null },
          },
        },
      },
      changedKey: "taxCalendar",
      before: v1.settings.taxCalendar,
      after: null,
      createdById: "a",
    });
    const snap = await getSettingsSnapshot(store);
    expect(snap.settings.taxCalendar.obligations["2551q"].dueDay).toBeNull();
  });

  it("round-trips other forms' dueDay and dueMonth through save then read", async () => {
    const store = memoryStore();
    const v1 = await getSettingsSnapshot(store);
    const next = {
      ...v1.settings.taxCalendar,
      obligations: {
        ...v1.settings.taxCalendar.obligations,
        "1701q": { enabled: true, dueDay: 20, dueMonth: null },
        "1701": { enabled: true, dueDay: 15, dueMonth: 5 },
        "1701a": { enabled: true, dueDay: 10, dueMonth: 4 },
        "2550q": { enabled: true, dueDay: 28, dueMonth: null },
        "0619e": { enabled: false, dueDay: 12, dueMonth: null },
      },
    };
    const res = await saveSettingsSection(store, {
      key: "taxCalendar",
      value: next,
      userId: "a",
      baseVersionId: v1.versionId,
    });
    expect(res.ok && res.changed).toBe(true);
    const snap = await getSettingsSnapshot(store);
    const o = snap.settings.taxCalendar.obligations;
    expect(o["1701q"]).toEqual({ enabled: true, dueDay: 20, dueMonth: null });
    expect(o["1701"]).toEqual({ enabled: true, dueDay: 15, dueMonth: 5 });
    expect(o["1701a"]).toEqual({ enabled: true, dueDay: 10, dueMonth: 4 });
    expect(o["2550q"]).toEqual({ enabled: true, dueDay: 28, dueMonth: null });
    expect(o["0619e"]).toEqual({ enabled: false, dueDay: 12, dueMonth: null });
  });
});

describe("settings forms", () => {
  it("reads list settings one option per line", () => {
    const form: Record<string, string> = { paymentTerms: "COD\n Net 30 \n\nNet 60", contactRoles: "End user\nOther" };
    expect(settingsValueFromForm("lists", (n) => form[n] ?? null)).toEqual({
      paymentTerms: ["COD", "Net 30", "Net 60"],
      contactRoles: ["End user", "Other"],
      // No presets field submitted → the seed presets ride along, so a
      // plain-lists save can never wipe presets back to nothing.
      paymentTermPresets: PAYMENT_TERM_PRESET_SEED,
    });
  });

  it("carries payment term presets through the lists form as hidden JSON", () => {
    const presets = [{ name: "Net 15", text: "Net 15", active: true }];
    const form: Record<string, string> = {
      paymentTerms: "COD",
      contactRoles: "Other",
      paymentTermPresets: JSON.stringify(presets),
    };
    expect(settingsValueFromForm("lists", (n) => form[n] ?? null)).toEqual({
      paymentTerms: ["COD"],
      contactRoles: ["Other"],
      paymentTermPresets: presets,
    });
  });

  it("lists only changed leaves for the change log", () => {
    expect(changedLeaves({ quote: { prefix: "Q", padding: 4 } }, { quote: { prefix: "QT", padding: 4 } })).toEqual([
      { key: "quote.prefix", before: "Q", after: "QT" },
    ]);
  });
});

describe("company profile slice 1 — identity & wording defaults", () => {
  it("seeds identity with today's hard-coded values, verbatim", () => {
    expect(DEFAULT_SETTINGS.identity).toEqual({
      policiesUrl: POLICIES_URL,
      policiesDisplayHost: POLICIES_DISPLAY_HOST,
      policyVersionLine: POLICY_VERSION_LINE,
      // src/lib/messaging/providers.ts DEFAULT_SMS_SENDER_ID (env still overrides).
      smsSenderId: "Hacien ITS",
      // The "hacien-" download prefix of the nine CSV export routes.
      csvFilePrefix: "hacien",
      // src/app/layout.tsx title + public/site.webmanifest name / short_name.
      appTitle: "HACIEN Staff",
      appShortName: "HACIEN",
    });
    // BUSINESS_IS_VAT_REGISTERED = false in src/lib/tax/constants.ts.
    expect(DEFAULT_SETTINGS.taxYear.isVatRegistered).toBe(false);
  });

  it("seeds the wording section word-for-word from the print constants", () => {
    const w = DEFAULT_SETTINGS.wording;
    expect(w.nonVatLabel).toBe(NON_VAT_LABEL);
    expect(w.inputTaxDisclaimer).toBe(INPUT_TAX_DISCLAIMER);
    expect(w.billingDisclaimer).toBe(BILLING_DISCLAIMER);
    expect(w.packingListDisclaimer).toBe(PACKING_LIST_DISCLAIMER);
    expect(w.ewt2307Note).toBe(EWT_2307_NOTE);
    expect(w.thankYou).toBe(THANK_YOU);
    expect(w.quotationNotInvoice).toBe(QUOTATION_NOT_INVOICE);
    expect(w.salesOrderNotInvoice).toBe(SALES_ORDER_NOT_INVOICE);
    expect(w.termsHeading).toBe(TERMS_AND_CONDITIONS_HEADING);
    expect(w.termsPoint2Cod).toBe(COD_POINT2_TEXT);
    expect(w.termsPoint4).toBe(QUOTE_SO_TERMS_POINT_4);
    expect(w.termsPoint6).toBe(QUOTE_SO_TERMS_POINT_6);
    expect(w.termsPoint7).toBe(QUOTE_SO_TERMS_POINT_7);
    expect(w.termsLateInterestPctPerYear).toBe(24);
    expect(w.termsAttorneysFeesPct).toBe(25);
  });

  it("rebuilds the printed terms block from the wording values exactly", () => {
    const w = DEFAULT_SETTINGS.wording;
    // Point 1: validity sentence + body, default and custom days.
    expect(`${w.termsPoint1ValidityDefault} ${w.termsPoint1Body}`).toBe(quoteSoTermsPoint1(15));
    expect(`${w.termsPoint1ValidityCustom.replace("{days}", "30")} ${w.termsPoint1Body}`).toBe(quoteSoTermsPoint1(30));
    // Point 2: each payment variant is its sentence + the anti-fraud sentence.
    expect(`${w.termsPoint2Upfront} ${w.termsPaymentAntiFraud}`).toBe(
      quoteSoTermsPoint2("100% upfront (software and special orders)"),
    );
    expect(`${w.termsPoint2FiftyFifty} ${w.termsPaymentAntiFraud}`).toBe(quoteSoTermsPoint2("50% down, 50% on delivery"));
    expect(`${w.termsPoint2Net30} ${w.termsPaymentAntiFraud}`).toBe(quoteSoTermsPoint2("Net 30 (approved accounts only)"));
    expect(w.termsPoint2Cod).toBe(quoteSoTermsPoint2("COD"));
    expect(`Payment: Pay on signing. ${w.termsCustomTermsAntiFraud}`).toBe(quoteSoTermsPoint2("Pay on signing"));
    expect(`Payment: ${w.termsPaymentAntiFraud}`).toBe(quoteSoTermsPoint2(null));
    // Point 3: lead-time template and the no-figure variant.
    expect(w.termsPoint3WithLeadTime.replace("{days}", "9")).toBe(quoteSoTermsPoint3(9));
    expect(w.termsPoint3NoLeadTime).toBe(quoteSoTermsPoint3(null));
    // Point 5: goods and services-only variants.
    expect(w.termsPoint5Goods).toBe(quoteSoTermsPoint5(false));
    expect(w.termsPoint5Services).toBe(quoteSoTermsPoint5(true));
    // The stored figures are the figures inside point 7's text.
    expect(w.termsPoint7).toContain(`${w.termsLateInterestPctPerYear}% interest a year`);
    expect(w.termsPoint7).toContain(`${w.termsAttorneysFeesPct}% attorney's fees`);
  });
});

describe("company profile slice 1 — pre-fill on read (no data migration)", () => {
  it("an old snapshot without identity/wording/isVatRegistered reads back with the seeded values", async () => {
    const store = memoryStore();
    const v1 = await getSettingsSnapshot(store);
    // Simulate a pre-slice-1 stored snapshot: the new sections/field absent.
    const oldData = structuredClone(v1.settings) as unknown as Record<string, unknown>;
    delete oldData.identity;
    delete oldData.wording;
    delete (oldData.taxYear as Record<string, unknown>).isVatRegistered;
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
    expect(snap.settings.identity).toEqual(DEFAULT_SETTINGS.identity);
    expect(snap.settings.wording).toEqual(DEFAULT_SETTINGS.wording);
    expect(snap.settings.taxYear.isVatRegistered).toBe(false);
    // Pinned reads (documents created under that version) take the same path.
    const pinned = await getSettingsVersion(store, snap.versionId);
    expect(pinned?.settings.identity).toEqual(DEFAULT_SETTINGS.identity);
    expect(pinned?.settings.wording).toEqual(DEFAULT_SETTINGS.wording);
  });

  it("saves identity and wording sections as new versions", async () => {
    const store = memoryStore();
    const v1 = await getSettingsSnapshot(store);
    const res = await saveSettingsSection(store, {
      key: "identity",
      value: { ...v1.settings.identity, smsSenderId: "ACME Corp" },
      userId: "a",
      baseVersionId: v1.versionId,
    });
    expect(res.ok && res.changed).toBe(true);
    const snap = await getSettingsSnapshot(store);
    expect(snap.settings.identity.smsSenderId).toBe("ACME Corp");
    expect(snap.settings.identity.policiesUrl).toBe(POLICIES_URL);

    const res2 = await saveSettingsSection(store, {
      key: "wording",
      value: { ...snap.settings.wording, thankYou: "Thank you" },
      userId: "a",
      baseVersionId: snap.versionId,
    });
    expect(res2.ok && res2.changed).toBe(true);
    const snap2 = await getSettingsSnapshot(store);
    expect(snap2.settings.wording.thankYou).toBe("Thank you");
    // The rest of the wording section carried through untouched.
    expect(snap2.settings.wording.billingDisclaimer).toBe(BILLING_DISCLAIMER);
  });

  it("rejects a blanked legal text and saves nothing", async () => {
    const store = memoryStore();
    const v1 = await getSettingsSnapshot(store);
    const res = await saveSettingsSection(store, {
      key: "wording",
      value: { ...v1.settings.wording, billingDisclaimer: "  " },
      userId: "a",
      baseVersionId: v1.versionId,
    });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected errors");
    expect(res.fieldErrors.billingDisclaimer).toMatch(/blank/);
    expect(store.rows).toHaveLength(1);
  });

  it("reads identity, wording and the VAT flag from submitted forms", () => {
    const strings: Record<string, string> = {
      ...DEFAULT_SETTINGS.identity,
      ...Object.fromEntries(Object.entries(DEFAULT_SETTINGS.wording).map(([k, v]) => [k, String(v)])),
    };
    const get = (n: string) => strings[n] ?? null;
    expect(settingsValueFromForm("identity", get)).toEqual(DEFAULT_SETTINGS.identity);
    // Form values are strings; the section schema coerces the two figures.
    expect(settingsSections.wording.parse(settingsValueFromForm("wording", get))).toEqual(DEFAULT_SETTINGS.wording);

    const taxYear = settingsValueFromForm("taxYear", (n) =>
      n === "isVatRegistered" ? "true" : null,
    ) as { isVatRegistered: boolean };
    expect(taxYear.isVatRegistered).toBe(true);
  });
});
