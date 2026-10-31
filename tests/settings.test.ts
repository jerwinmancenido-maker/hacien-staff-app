import { describe, expect, it } from "vitest";
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
    expect(DEFAULT_SETTINGS.approval).toEqual({ marginBelowPct: 18, totalAbove: 500000 });
    expect(DEFAULT_SETTINGS.quotes.defaultValidityDays).toBe(30);
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
      value: { marginBelowPct: "20", totalAbove: "750000" },
      userId: "jerwin",
      baseVersionId: v1.versionId,
    });
    expect(res.ok && res.changed).toBe(true);
    if (!res.ok) throw new Error("expected ok");
    expect(res.version.version).toBe(2);
    expect(res.version.createdById).toBe("jerwin");
    expect(res.version.changedKey).toBe("approval");
    expect(res.version.before).toEqual({ marginBelowPct: 18, totalAbove: 500000 });
    expect(res.version.after).toEqual({ marginBelowPct: 20, totalAbove: 750000 });
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
    expect(old?.settings.approval).toEqual({ marginBelowPct: 18, totalAbove: 500000 });
    // Untouched sections are carried forward into the new version.
    expect(current.settings.numbering).toEqual(old?.settings.numbering);
  });

  it("rejects a save based on an outdated version", async () => {
    const store = memoryStore();
    const v1 = await getSettingsSnapshot(store);
    await saveSettingsSection(store, { key: "quotes", value: { defaultValidityDays: 15 }, userId: "a", baseVersionId: v1.versionId });
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
      value: { defaultValidityDays: 15 },
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
    const res = await saveSettingsSection(store, { key: "quotes", value: { defaultValidityDays: "30" }, userId: "a", baseVersionId: v1.versionId });
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
    });
  });

  it("lists only changed leaves for the change log", () => {
    expect(changedLeaves({ quote: { prefix: "Q", padding: 4 } }, { quote: { prefix: "QT", padding: 4 } })).toEqual([
      { key: "quote.prefix", before: "Q", after: "QT" },
    ]);
  });
});
