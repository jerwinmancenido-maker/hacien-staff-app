import { describe, expect, it } from "vitest";
import { dealsNavHrefs } from "@/components/Sidebar";
import { BOOKS_FORBIDDEN_VAT_KEYS, REGISTER_CONFIGS, REGISTER_KEYS } from "@/lib/books/config";
import {
  buildRegister,
  COLLECTED_TOTAL_LABEL,
  csvCell,
  INVOICED_TOTAL_LABEL,
  registerHasVatColumn,
  registerToCsv,
  sumMoney,
} from "@/lib/books/registers";
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

  it("sidebar Books item needs BOOKS_ENABLED and view_books; Cash/Payables stay independently gated", () => {
    const base = { canSeeCosts: true, canEdit: true, cashEnabled: true, payablesEnabled: true };
    expect(dealsNavHrefs({ ...base, booksEnabled: false, canViewBooks: true })).not.toContain("/books");
    expect(dealsNavHrefs({ ...base, booksEnabled: true, canViewBooks: false })).not.toContain("/books");
    expect(dealsNavHrefs({ ...base, booksEnabled: true, canViewBooks: true })).toContain("/books");
    expect(dealsNavHrefs({ ...base, booksEnabled: true, canViewBooks: true, cashEnabled: false })).not.toContain("/cash");
    expect(dealsNavHrefs({ ...base, booksEnabled: true, canViewBooks: true, payablesEnabled: false })).not.toContain("/payables");
    // Tax worksheets live under Books (/books/tax) — no separate Deals nav item;
    // gating is booksOnly via filterDealsNavItems (same path as Cash/Payables flags).
    const hrefs = dealsNavHrefs({ ...base, booksEnabled: true, canViewBooks: true });
    expect(hrefs).not.toContain("/books/tax");
    expect(hrefs.filter((h) => h.startsWith("/books")).length).toBe(1);
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

describe("CSV formula injection (csvCell)", () => {
  it("prefixes formula-risky leading characters with a single quote", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("+cmd")).toBe("'+cmd");
    expect(csvCell("\tTAB")).toBe("'\tTAB");
    expect(csvCell("\rCR")).toBe("'\rCR");
  });

  it("handles a normal negative number by prefixing ' (leading - is formula-risky)", () => {
    // Negatives start with "-", so they get the apostrophe. Positive money does not.
    expect(csvCell("-100.00")).toBe("'-100.00");
    expect(csvCell("100.00")).toBe("100.00");
  });

  it("leaves normal text alone; still quotes commas and embedded quotes", () => {
    expect(csvCell("Sample Corp")).toBe("Sample Corp");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    // Formula risk + comma → apostrophe first, then quote the whole cell
    expect(csvCell("=1,2")).toBe('"\'=1,2"');
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

describe("sales register — separate Invoiced / Collected totals (no combined)", () => {
  const sales = REGISTER_CONFIGS.sales;

  it("seed case: Invoiced 15000 and Collected 5000; never a 20000 combined total", () => {
    const sources: BookSourceRow[] = [
      row({ id: "inv", kind: "BILLING", date: "2026-03-10", amount: "15000.00", ewt: "150.00" }),
      row({ id: "col", kind: "COLLECTION", date: "2026-03-15", amount: "5000.00", ewt: "0.00" }),
    ];
    const reg = buildRegister(sales, sources, "2026-03-01", "2026-03-31");
    expect(reg.periodAmountTotal).toBeNull();
    expect(reg.salesPeriodTotals).toEqual({
      invoicedAmount: "15000.00",
      invoicedEwt: "150.00",
      collectedAmount: "5000.00",
      collectedEwt: "0.00",
    });
    const csv = registerToCsv(sales, reg);
    expect(csv).toContain(INVOICED_TOTAL_LABEL);
    expect(csv).toContain(COLLECTED_TOTAL_LABEL);
    expect(csv).toContain("15000.00");
    expect(csv).toContain("5000.00");
    expect(csv).not.toContain("20000");
    expect(csv).not.toContain("20,000");
    expect(csv).not.toContain("Period total");
  });

  it("voids drop out of the matching total only", () => {
    const sources: BookSourceRow[] = [
      row({ id: "1", kind: "BILLING", date: "2026-03-10", amount: "1000.10", ewt: "10.01" }),
      row({ id: "2", kind: "COLLECTION", date: "2026-03-15", amount: "250.25", ewt: "0.00" }),
      row({ id: "3", kind: "BILLING", date: "2026-03-20", amount: "999.99", ewt: "5.00", voided: true }),
      row({ id: "4", kind: "SUPPLIER_BILL", date: "2026-03-12", amount: "500.00" }),
      row({ id: "5", kind: "COLLECTION", date: "2026-04-01", amount: "50.00", ewt: "1.00" }),
    ];
    const reg = buildRegister(sales, sources, "2026-03-01", "2026-03-31");
    expect(reg.rowCount).toBe(2);
    expect(reg.salesPeriodTotals!.invoicedAmount).toBe("1000.10");
    expect(reg.salesPeriodTotals!.collectedAmount).toBe("250.25");
    expect(reg.periodAmountTotal).toBeNull();
  });

  it("page totals still accumulate row amounts on the page; CSV has no combined period line", () => {
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
    expect(reg.salesPeriodTotals!.invoicedAmount).toBe("300.00");
    expect(reg.salesPeriodTotals!.collectedAmount).toBe("50.00");
    const csv = registerToCsv(cfg, reg);
    expect(csv).toContain(INVOICED_TOTAL_LABEL);
    expect(csv).toContain(COLLECTED_TOTAL_LABEL);
    expect(csv).not.toContain("Period total");
    expect(csv.toLowerCase()).not.toMatch(/\bvat\b/);
  });
});

describe("non-sales registers keep a single period total", () => {
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
    expect(sumMoney(["0.10", "0.20", "0.30"])).toBe("0.60");
  });
});
