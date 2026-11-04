import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { groupSupplierPrices } from "@/lib/items/history";
import { validateReminderInput, REMINDER_TARGETS } from "@/lib/services/reminders";

const root = process.cwd();
const src = (p: string) => readFileSync(join(root, p), "utf8");

describe("S-56 supplier price compare grouping", () => {
  it("keeps the newest PO cost per supplier and sorts cheapest first", () => {
    const rows = groupSupplierPrices([
      { supplierId: "s1", supplierName: "Alpha", description: "Widget", date: "2026-11-03", poNumber: "PO-2", cost: "90.00" },
      { supplierId: "s1", supplierName: "Alpha", description: "Widget", date: "2026-11-01", poNumber: "PO-1", cost: "100.00" },
      { supplierId: "s2", supplierName: "Beta", description: "Widget", date: "2026-11-02", poNumber: "PO-3", cost: "80.00" },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.supplierName).toBe("Beta");
    expect(rows[0]!.lastCost).toBe("80.00");
    expect(rows[1]!.supplierName).toBe("Alpha");
    expect(rows[1]!.lastCost).toBe("90.00");
  });
});

describe("S-56 reminder validation", () => {
  it("accepts a valid reminder", () => {
    const valid = validateReminderInput({ entityType: "QUOTE", remindAt: "2026-11-10", note: "Follow up" });
    expect(valid.entityType).toBe("QUOTE");
    expect(valid.note).toBe("Follow up");
  });
  it("rejects unknown targets, blank notes and bad dates", () => {
    expect(() => validateReminderInput({ entityType: "BILLING", remindAt: "2026-11-10", note: "x" })).toThrow();
    expect(() => validateReminderInput({ entityType: "QUOTE", remindAt: "2026-11-10", note: "   " })).toThrow();
    expect(() => validateReminderInput({ entityType: "QUOTE", remindAt: "Nov 10", note: "x" })).toThrow();
  });
  it("covers quote, sales order and PO targets", () => {
    expect([...REMINDER_TARGETS]).toEqual(["QUOTE", "SALES_ORDER", "PURCHASE_ORDER"]);
  });
});

describe("S-56 surfaces", () => {
  it("reminder model exists and is personal (createdById)", () => {
    const schema = src("prisma/schema.prisma");
    expect(schema).toContain("model Reminder");
    expect(schema).toContain("createdById");
  });
  it("PO and SO pages have an Attachments tab", () => {
    expect(src("src/app/(app)/purchase-orders/[id]/page.tsx")).toContain('"attachments"');
    expect(src("src/app/(app)/sales-orders/[id]/page.tsx")).toContain('"attachments"');
    expect(src("src/components/AttachmentsTab.tsx")).toContain("/files/attachments/");
  });
  it("Remind-me form is on quote, SO and PO pages, and the Reminders page lists them", () => {
    expect(src("src/app/(app)/quotes/[id]/page.tsx")).toContain('entityType="QUOTE"');
    expect(src("src/app/(app)/sales-orders/[id]/page.tsx")).toContain('entityType="SALES_ORDER"');
    expect(src("src/app/(app)/purchase-orders/[id]/page.tsx")).toContain('entityType="PURCHASE_ORDER"');
    expect(src("src/app/(app)/reminders/page.tsx")).toContain("Overdue");
    expect(src("src/components/Sidebar.tsx")).toContain('href: "/reminders"');
  });
  it("compare page and Items-page compare links exist", () => {
    expect(src("src/app/(app)/items/compare/page.tsx")).toContain("listSupplierPriceComparison");
    expect(src("src/app/(app)/items/page.tsx")).toContain("/items/compare?item=");
  });
});
