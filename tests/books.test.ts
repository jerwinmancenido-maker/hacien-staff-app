import { describe, expect, it } from "vitest";
import { BOOKS_FORBIDDEN_VAT_KEYS, REGISTER_CONFIGS, REGISTER_KEYS } from "@/lib/books/config";
import { buildRegister, registerHasVatColumn, registerToCsv, sumMoney } from "@/lib/books/registers";
import { booksEnabledFromEnv } from "@/lib/books/features";
import {
  currentMonthPeriod,
  instantInPeriod,
  manilaYmdFromInstant,
  parseBooksPeriod,
  ymdInPeriod,
} from "@/lib/books/period";
import { can, roleFlags, type PermissionUser, type Role } from "@/lib/permissions";
import { DEFAULT_SETTINGS } from "@/lib/settings/defaults";
import type { BookSourceRow } from "@/lib/books/registers";

function user(roles: Role[]): PermissionUser {
  return { ...roleFlags(roles), active: true, canSeeCosts: false };
}

describe("view_books permission", () => {
  it("Admin and Approver only", () => {
    expect(can(user(["ADMIN"]), "view_books")).toBe(true);
    expect(can(user(["APPROVER"]), "view_books")).toBe(true);
    expect(can(user(["STAFF"]), "view_books")).toBe(false);
    expect(can(user(["VIEWER"]), "view_books")).toBe(false);
  });
});

describe("books feature flag", () => {
  it("defaults off; env overrides", () => {
    expect(booksEnabledFromEnv({})).toBe(null);
    expect(booksEnabledFromEnv({ BOOKS_ENABLED: "true" })).toBe(true);
    expect(booksEnabledFromEnv({ BOOKS_ENABLED: "0" })).toBe(false);
    expect(DEFAULT_SETTINGS.features.booksEnabled).toBe(false);
  });
});

describe("cash gating inside books rows", () => {
  it("allows expense rows with null href when Cash is off (no /cash bypass)", () => {
    const sources: BookSourceRow[] = [
      row({ id: "e1", kind: "EXPENSE", date: "2026-06-05", amount: "50.00", ewt: "0.00", href: null }),
      row({ id: "p1", kind: "SUPPLIER_PAYMENT", date: "2026-06-04", amount: "40.00", ewt: "4.00", href: "/payables/payments/p1" }),
    ];
    const reg = buildRegister(REGISTER_CONFIGS.disbursements, sources, "2026-06-01", "2026-06-30");
    expect(reg.rowCount).toBe(2);
    expect(reg.rows.find((r) => r.kind === "EXPENSE")?.href).toBeNull();
    expect(reg.rows.find((r) => r.kind === "SUPPLIER_PAYMENT")?.href).toMatch(/^\/payables\//);
  });
});

describe("no VAT fields on Books registers", () => {
  it("column configs never include VAT / input tax", () => {
    for (const key of REGISTER_KEYS) {
      const cfg = REGISTER_CONFIGS[key];
      expect(registerHasVatColumn(cfg)).toBe(false);
      for (const col of cfg.columns) {
        for (const bad of BOOKS_FORBIDDEN_VAT_KEYS) {
          expect(col.key.toLowerCase()).not.toContain(bad.toLowerCase().replace(/_/g, ""));
          expect(col.label.toLowerCase()).not.toMatch(/vat|input tax|output tax/);
        }
      }
    }
  });
});

describe("PHT period boundaries (including UTC-stored timestamps)", () => {
  it("maps Manila calendar days from UTC instants", () => {
    // 23:59 PHT on 2026-03-31 = 15:59 UTC → still March 31
    expect(manilaYmdFromInstant(new Date("2026-03-31T15:59:00.000Z"))).toBe("2026-03-31");
    // 00:00 PHT on 2026-04-01 = 16:00 UTC March 31 → April 1
    expect(manilaYmdFromInstant(new Date("2026-03-31T16:00:00.000Z"))).toBe("2026-04-01");
  });

  it("includes 23:59 PHT last day; excludes 00:00 PHT next day", () => {
    const from = "2026-03-01";
    const to = "2026-03-31";
    expect(instantInPeriod(new Date("2026-03-31T15:59:59.000Z"), from, to)).toBe(true);
    expect(instantInPeriod(new Date("2026-03-31T16:00:00.000Z"), from, to)).toBe(false);
    // DATE-column style (UTC midnight of Manila day)
    expect(instantInPeriod(new Date("2026-03-31T00:00:00.000Z"), from, to)).toBe(true);
    expect(instantInPeriod(new Date("2026-04-01T00:00:00.000Z"), from, to)).toBe(false);
  });

  it("defaults to current Manila month", () => {
    const fixed = new Date("2026-10-15T08:00:00.000Z"); // still Oct 15 PHT
    const p = currentMonthPeriod(fixed);
    expect(p.fromYmd).toBe("2026-10-01");
    expect(p.toYmd).toBe("2026-10-31");
    expect(p.isDefaultMonth).toBe(true);
    const custom = parseBooksPeriod("2026-02-01", "2026-02-28", fixed);
    expect(custom.isDefaultMonth).toBe(false);
    expect(ymdInPeriod("2026-02-15", custom.fromYmd, custom.toYmd)).toBe(true);
  });
});

function row(partial: Partial<BookSourceRow> & Pick<BookSourceRow, "id" | "kind" | "date" | "amount">): BookSourceRow {
  return {
    documentNumber: partial.documentNumber ?? `DOC-${partial.id}`,
    party: partial.party ?? "Party",
    particulars: partial.particulars ?? "Particulars",
    ewt: partial.ewt ?? null,
    href: partial.href ?? `/x/${partial.id}`,
    voided: partial.voided,
    ...partial,
  };
}

describe("register totals (scaled decimals, voids excluded)", () => {
  const sales = REGISTER_CONFIGS.sales;

  it("period total equals sum of source amounts; voids drop out", () => {
    const sources: BookSourceRow[] = [
      row({ id: "1", kind: "BILLING", date: "2026-03-10", amount: "1000.10", ewt: "10.01" }),
      row({ id: "2", kind: "COLLECTION", date: "2026-03-15", amount: "250.25", ewt: "0.00" }),
      row({ id: "3", kind: "BILLING", date: "2026-03-20", amount: "999.99", ewt: "5.00", voided: true }),
      row({ id: "4", kind: "SUPPLIER_BILL", date: "2026-03-12", amount: "500.00" }), // wrong kind for sales
      row({ id: "5", kind: "COLLECTION", date: "2026-04-01", amount: "50.00", ewt: "1.00" }), // out of period
    ];
    const reg = buildRegister(sales, sources, "2026-03-01", "2026-03-31");
    expect(reg.rowCount).toBe(2);
    expect(reg.periodAmountTotal).toBe(sumMoney(["1000.10", "250.25"]));
    expect(reg.periodAmountTotal).toBe("1250.35");
    expect(reg.periodEwtTotal).toBe("10.01");
  });

  it("never uses floats for awkward cents", () => {
    const sources = [
      row({ id: "a", kind: "BILLING", date: "2026-01-01", amount: "0.10", ewt: "0.01" }),
      row({ id: "b", kind: "BILLING", date: "2026-01-02", amount: "0.20", ewt: "0.02" }),
      row({ id: "c", kind: "COLLECTION", date: "2026-01-03", amount: "0.30", ewt: "0.03" }),
    ];
    const reg = buildRegister(sales, sources, "2026-01-01", "2026-01-31");
    expect(reg.periodAmountTotal).toBe("0.60");
    expect(reg.periodEwtTotal).toBe("0.06");
  });

  it("page totals accumulate and CSV has period total", () => {
    const cfg = { ...REGISTER_CONFIGS.sales, rowsPerPage: 2 };
    const sources = [
      row({ id: "1", kind: "BILLING", date: "2026-05-01", amount: "100.00", ewt: "1.00" }),
      row({ id: "2", kind: "BILLING", date: "2026-05-02", amount: "200.00", ewt: "2.00" }),
      row({ id: "3", kind: "COLLECTION", date: "2026-05-03", amount: "50.00", ewt: "0.50" }),
    ];
    const reg = buildRegister(cfg, sources, "2026-05-01", "2026-05-31");
    expect(reg.pageTotals).toHaveLength(2);
    expect(reg.pageTotals[0]!.amountTotal).toBe("300.00");
    expect(reg.pageTotals[1]!.amountTotal).toBe("50.00");
    expect(reg.periodAmountTotal).toBe("350.00");
    const csv = registerToCsv(cfg, reg);
    expect(csv).toContain("Period total");
    expect(csv).toContain("350.00");
    expect(csv.toLowerCase()).not.toMatch(/\bvat\b/);
  });

  it("disbursements and purchases and journal wire the right sources", () => {
    const sources: BookSourceRow[] = [
      row({ id: "b", kind: "BILLING", date: "2026-06-01", amount: "10.00", ewt: "0.10" }),
      row({ id: "c", kind: "COLLECTION", date: "2026-06-02", amount: "20.00", ewt: "0" }),
      row({ id: "sb", kind: "SUPPLIER_BILL", date: "2026-06-03", amount: "30.00" }),
      row({ id: "sp", kind: "SUPPLIER_PAYMENT", date: "2026-06-04", amount: "40.00", ewt: "4.00" }),
      row({ id: "e", kind: "EXPENSE", date: "2026-06-05", amount: "50.00", ewt: "5.00" }),
    ];
    expect(buildRegister(REGISTER_CONFIGS.disbursements, sources, "2026-06-01", "2026-06-30").periodAmountTotal).toBe("90.00");
    expect(buildRegister(REGISTER_CONFIGS.purchases, sources, "2026-06-01", "2026-06-30").periodAmountTotal).toBe("30.00");
    expect(buildRegister(REGISTER_CONFIGS.journal, sources, "2026-06-01", "2026-06-30").rowCount).toBe(5);
    expect(buildRegister(REGISTER_CONFIGS.journal, sources, "2026-06-01", "2026-06-30").periodAmountTotal).toBe("150.00");
  });
});
