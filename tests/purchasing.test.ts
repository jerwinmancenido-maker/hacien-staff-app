// Supplier POs, receiving and the 3-way match: the pure rules.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  afterEdit,
  approverError,
  canPo,
  closeError,
  poActionError,
  poMarkSentError,
  poNeedsApproval,
  PO_STATUSES,
  receiptStatus,
  soLineProgress,
  voidError,
  type PoAction,
  type PoStatus,
} from "@/lib/purchasing/status";
import { planPurchaseOrders, qtyMismatch, type SoLineForPo } from "@/lib/purchasing/plan";
import { applyReceipt, checkReceipt, remainingQty } from "@/lib/purchasing/receipt";
import { priceDifferenceText, threeWayMatch } from "@/lib/purchasing/match";
import { allocateDocNumber, formatDocNumber, seriesYear } from "@/lib/documents/series";
import { DEFAULT_SETTINGS } from "@/lib/settings/defaults";
import { getSettingsSnapshot, type SettingsStore, type SettingsVersionRecord } from "@/lib/settings/service";
import { NUMBERED_DOCS } from "@/lib/settings/form";
import { stripCosts, roleFlags } from "@/lib/permissions";
import { ProfessionalPrintDocument } from "@/components/docs/ProfessionalPrintDocument";
import { missingCompanyPrintFields } from "@/lib/print/company";
import { draftPoFixture, poPrintFixture } from "./fixtures/print-doc";

const line = (id: string, supplierId: string | null, extra: Partial<SoLineForPo> = {}): SoLineForPo => ({
  id,
  sortOrder: Number(id.replace(/\D/g, "")) || 0,
  description: `Item ${id}`,
  kind: "GOODS",
  qty: "10.00",
  unit: "pc",
  supplierId,
  supplierUnitCost: "450.00",
  ...extra,
});

describe("create POs from a sales order", () => {
  it("groups SO lines by supplier, one PO per supplier, in SO line order", () => {
    const plan = planPurchaseOrders([line("l3", "A"), line("l1", "A"), line("l2", "B")], new Set());
    expect(plan.pos.map((p) => p.supplierId)).toEqual(["A", "B"]);
    expect(plan.pos[0]!.lines.map((l) => l.salesOrderItemId)).toEqual(["l1", "l3"]);
    expect(plan.pos[1]!.lines.map((l) => l.salesOrderItemId)).toEqual(["l2"]);
  });

  it("copies description, qty, unit and the SO line's supplier unit cost", () => {
    const plan = planPurchaseOrders([line("l1", "A", { description: "Laptop i5", qty: "3.50", unit: "set", supplierUnitCost: "45123.45", kind: "SERVICES" })], new Set());
    expect(plan.pos[0]!.lines[0]).toEqual({ salesOrderItemId: "l1", description: "Laptop i5", kind: "SERVICES", qty: "3.50", unit: "set", unitCost: "45123.45" });
  });

  it("lists lines without a supplier as 'needs a supplier' and skips them, unless one is picked", () => {
    const lines = [line("l1", "A"), line("l2", null)];
    const plan = planPurchaseOrders(lines, new Set());
    expect(plan.needsSupplier.map((l) => l.id)).toEqual(["l2"]);
    expect(plan.pos).toHaveLength(1);
    const picked = planPurchaseOrders(lines, new Set(), { l2: "B" });
    expect(picked.needsSupplier).toEqual([]);
    expect(picked.pos.map((p) => p.supplierId)).toEqual(["A", "B"]);
  });

  it("excludes lines already on a non-void PO, and unticked lines", () => {
    const plan = planPurchaseOrders([line("l1", "A"), line("l2", "A"), line("l3", "B")], new Set(["l1"]), {}, new Set(["l1", "l2"]));
    expect(plan.alreadyOrdered.map((l) => l.id)).toEqual(["l1"]);
    expect(plan.pos).toEqual([{ supplierId: "A", lines: [expect.objectContaining({ salesOrderItemId: "l2" })] }]);
  });

  it("warns when PO qty for a SO line differs from the SO qty", () => {
    expect(qtyMismatch("10.00", ["10.00"])).toBeNull();
    expect(qtyMismatch("10.00", ["4", "6"])).toBeNull();
    expect(qtyMismatch("10.00", ["8.00"])).toMatch(/less/);
    expect(qtyMismatch("10.00", ["12.00"])).toMatch(/more/);
  });
});

describe("PO status machine", () => {
  const expected: Record<PoAction, PoStatus[]> = {
    edit: ["DRAFT", "APPROVED"],
    approve: ["DRAFT"],
    markSent: ["APPROVED"],
    receive: ["SENT", "PARTIALLY_RECEIVED"],
    close: ["PARTIALLY_RECEIVED", "RECEIVED"],
    void: ["DRAFT", "APPROVED", "SENT"],
    bill: ["SENT", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED"],
  };

  it.each(Object.entries(expected))("%s is allowed exactly from its statuses", (action, allowed) => {
    for (const s of PO_STATUSES) {
      expect(canPo(s, action as PoAction), `${action} from ${s}`).toBe(allowed.includes(s));
      if (!allowed.includes(s)) expect(poActionError(s, action as PoAction)).toBeTruthy();
      else expect(poActionError(s, action as PoAction)).toBeNull();
    }
  });

  it("says a void PO is void for any action", () => {
    for (const a of Object.keys(expected) as PoAction[]) expect(poActionError("VOID", a)).toBe("This PO is void.");
  });

  it("editing an approved PO returns it to Draft and clears the approval", () => {
    expect(afterEdit("APPROVED")).toEqual({ status: "DRAFT", clearsApproval: true });
    expect(afterEdit("DRAFT")).toEqual({ status: "DRAFT", clearsApproval: false });
  });

  it("Approver may not self-approve; Admin may", () => {
    expect(approverError({ id: "u1" }, "u1")).toMatch(/other than the creator/);
    expect(approverError({ id: "u1", isAdmin: false }, "u1")).toMatch(/other than the creator/);
    expect(approverError({ id: "u1", isAdmin: true }, "u1")).toBeNull();
    expect(approverError({ id: "u2", isAdmin: false }, "u1")).toBeNull();
  });

  it("PO needs approval only when subtotal is strictly above the limit (scaled cents)", () => {
    expect(poNeedsApproval("100000.00", 100_000)).toBe(false);
    expect(poNeedsApproval("100000.01", 100_000)).toBe(true);
    expect(poNeedsApproval("99999.99", "100000")).toBe(false);
    expect(poMarkSentError("DRAFT", false)).toBeNull();
    expect(poMarkSentError("DRAFT", true)).toMatch(/Approve/);
    expect(poMarkSentError("APPROVED", true)).toBeNull();
  });

  it("short-close needs a reason; closing a fully received PO doesn't", () => {
    expect(closeError("RECEIVED", null)).toBeNull();
    expect(closeError("PARTIALLY_RECEIVED", "  ")).toMatch(/reason/);
    expect(closeError("PARTIALLY_RECEIVED", "Supplier out of stock")).toBeNull();
    expect(closeError("SENT", "x")).toMatch(/partially or fully received/);
    expect(closeError("DRAFT", "x")).toBeTruthy();
  });

  it("void needs no posted receiving report", () => {
    expect(voidError("SENT", 0)).toBeNull();
    expect(voidError("SENT", 1)).toBe("Void the receiving reports first.");
    expect(voidError("PARTIALLY_RECEIVED", 0)).toBeTruthy();
    expect(voidError("RECEIVED", 0)).toBeTruthy();
    expect(voidError("CLOSED", 0)).toBeTruthy();
  });

  it("derives SENT / PARTIALLY_RECEIVED / RECEIVED from received quantities", () => {
    expect(receiptStatus([{ qty: "10", receivedQty: "0" }, { qty: "5", receivedQty: "0" }])).toBe("SENT");
    expect(receiptStatus([{ qty: "10", receivedQty: "4" }, { qty: "5", receivedQty: "0" }])).toBe("PARTIALLY_RECEIVED");
    expect(receiptStatus([{ qty: "10", receivedQty: "10" }, { qty: "5", receivedQty: "4.99" }])).toBe("PARTIALLY_RECEIVED");
    expect(receiptStatus([{ qty: "10", receivedQty: "10" }, { qty: "5", receivedQty: "5" }])).toBe("RECEIVED");
  });

  it("SO line progress: not ordered / ordered / partial / received", () => {
    expect(soLineProgress("10", []).state).toBe("NOT_ORDERED");
    expect(soLineProgress("10", [{ qty: "10", receivedQty: "0" }]).state).toBe("ORDERED");
    expect(soLineProgress("10", [{ qty: "10", receivedQty: "3" }])).toEqual({ state: "PARTIALLY_RECEIVED", ordered: "10.00", received: "3.00" });
    expect(soLineProgress("10", [{ qty: "6", receivedQty: "6" }, { qty: "4", receivedQty: "4" }]).state).toBe("RECEIVED");
  });
});

describe("over-receive guard", () => {
  const lines = [
    { id: "a", description: "Laptop", qty: "10.00", receivedQty: "7.00" },
    { id: "b", description: "Mouse", qty: "5.00", receivedQty: "0.00" },
  ];

  it("shows the remaining quantity", () => {
    expect(remainingQty(lines[0]!)).toBe("3.00");
    expect(remainingQty({ qty: "1", receivedQty: "2" })).toBe("0.00");
  });

  it("accepts partial receipts and skips 0 / blank lines", () => {
    const r = checkReceipt(lines, [
      { lineId: "a", qty: "3" },
      { lineId: "b", qty: "" },
    ]);
    expect(r).toEqual({ ok: true, entries: [{ lineId: "a", qty: "3.00" }] });
    expect(checkReceipt(lines, [{ lineId: "b", qty: "0" }, { lineId: "a", qty: "1.5" }])).toEqual({ ok: true, entries: [{ lineId: "a", qty: "1.50" }] });
  });

  it("rejects receivedQty + qty > ordered", () => {
    const r = checkReceipt(lines, [{ lineId: "a", qty: "3.01" }]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.a).toMatch(/Only 3 left/);
      expect(r.message).toMatch(/more than was ordered/);
    }
  });

  it("rejects bad numbers, unknown lines, duplicates and an all-zero receipt", () => {
    expect(checkReceipt(lines, [{ lineId: "a", qty: "-1" }]).ok).toBe(false);
    expect(checkReceipt(lines, [{ lineId: "zz", qty: "1" }]).ok).toBe(false);
    expect(checkReceipt(lines, [{ lineId: "b", qty: "1" }, { lineId: "b", qty: "1" }]).ok).toBe(false);
    expect(checkReceipt(lines, [{ lineId: "a", qty: "0" }])).toEqual({ ok: false, errors: {}, message: "Enter a quantity for at least one line." });
  });

  it("applies and reverses receipts (RR void) within 0…ordered", () => {
    expect(applyReceipt({ qty: "10", receivedQty: "7" }, "3", 1)).toBe("10.00");
    expect(applyReceipt({ qty: "10", receivedQty: "7" }, "3", -1)).toBe("4.00");
    expect(() => applyReceipt({ qty: "10", receivedQty: "7" }, "4", 1)).toThrow();
    expect(() => applyReceipt({ qty: "10", receivedQty: "2" }, "3", -1)).toThrow();
  });
});

describe("3-way match", () => {
  const po = [
    { id: "a", description: "Laptop", unit: "pc", qty: "10.00", unitCost: "45000.00", receivedQty: "10.00" },
    { id: "b", description: "Mouse", unit: "pc", qty: "5.00", unitCost: "500.00", receivedQty: "5.00" },
  ];

  it("matches when billed qty and price equal received and PO", () => {
    const m = threeWayMatch(po, [{ id: "1", billNumber: "SI-1", amount: "452500.00", items: [{ purchaseOrderItemId: "a", qty: "10", unitPrice: "45000" }, { purchaseOrderItemId: "b", qty: "5", unitPrice: "500" }] }]);
    expect(m.status).toBe("MATCHED");
    expect(m.lines.map((l) => l.status)).toEqual(["MATCHED", "MATCHED"]);
    expect(m.headerFlags).toEqual([]);
    expect(m.receivedTotal).toBe("452500.00");
  });

  it("flags a unit price difference with the amount", () => {
    const m = threeWayMatch(po, [{ id: "1", billNumber: "SI-1", amount: "455000.00", items: [{ purchaseOrderItemId: "a", qty: "10", unitPrice: "45250" }, { purchaseOrderItemId: "b", qty: "5", unitPrice: "500" }] }]);
    const a = m.lines[0]!;
    expect(a.flags).toContain("PRICE_DIFFERS");
    expect(a.status).toBe("PRICE_MISMATCH");
    expect(a.priceDifferenceTotal).toBe("2500.00");
    expect(a.unitPriceDifference).toBe("250.00");
    expect(a.billedUnitPrice).toBe("45250.00");
    expect(m.status).toBe("MISMATCH");
    expect(m.headerFlags.map((f) => f.code)).toEqual(["BILLED_DIFFERS_FROM_RECEIVED"]);
    expect(m.headerFlags[0]!.amount).toBe("2500.00");
  });

  it("flags billed > received and received < ordered as qty mismatches", () => {
    const partial = [{ ...po[0]!, receivedQty: "6.00" }];
    const m = threeWayMatch(partial, [{ id: "1", billNumber: "SI-2", amount: "360000.00", items: [{ purchaseOrderItemId: "a", qty: "8", unitPrice: "45000" }] }]);
    expect(m.lines[0]!.flags).toEqual(["BILLED_MORE_THAN_RECEIVED", "RECEIVED_LESS_THAN_ORDERED"]);
    expect(m.lines[0]!.status).toBe("QTY_MISMATCH");
  });

  it("flags a bill whose header amount ≠ the sum of its lines", () => {
    const m = threeWayMatch(po, [{ id: "1", billNumber: "SI-3", amount: "452600.00", items: [{ purchaseOrderItemId: "a", qty: "10", unitPrice: "45000" }, { purchaseOrderItemId: "b", qty: "5", unitPrice: "500" }] }]);
    expect(m.headerFlags.map((f) => f.code)).toEqual(["BILL_LINES_DIFFER", "BILLED_DIFFERS_FROM_RECEIVED"]);
    expect(m.headerFlags[0]!.amount).toBe("100.00");
  });

  it("shows the price difference per unit (₱50), with the line total (₱500) second", () => {
    const m = threeWayMatch(po, [{ id: "1", billNumber: "SI-5", amount: "452750.00", items: [{ purchaseOrderItemId: "a", qty: "10", unitPrice: "45000" }, { purchaseOrderItemId: "b", qty: "5", unitPrice: "550" }] }]);
    const b = m.lines[1]!;
    expect(b.flags).toEqual(["PRICE_DIFFERS"]);
    expect(b.unitPriceDifference).toBe("50.00");
    expect(b.priceDifferenceTotal).toBe("250.00");
    const ten = threeWayMatch([{ ...po[1]!, qty: "10.00", receivedQty: "10.00" }], [{ id: "1", billNumber: "SI-6", amount: "5500.00", items: [{ purchaseOrderItemId: "b", qty: "10", unitPrice: "550" }] }]).lines[0]!;
    expect(ten.unitPriceDifference).toBe("50.00");
    expect(ten.priceDifferenceTotal).toBe("500.00");
    const text = priceDifferenceText(ten)!;
    expect(text.perUnit).toBe("+₱50.00 / pc");
    expect(text.perUnit).not.toContain("500");
    expect(text.lineTotal).toBe("+₱500.00 on the line");
  });

  it("shows a negative per-unit difference and averages mixed billed prices", () => {
    const under = threeWayMatch([po[1]!], [{ id: "1", billNumber: "SI-7", amount: "2400.00", items: [{ purchaseOrderItemId: "b", qty: "5", unitPrice: "480" }] }]).lines[0]!;
    expect(under.unitPriceDifference).toBe("-20.00");
    expect(priceDifferenceText(under)!.perUnit).toBe("-₱20.00 / pc");
    // 2 @ 510 and 3 @ 520 against a PO cost of 500: +80 on 5 units = +16 per unit.
    const mixed = threeWayMatch([po[1]!], [
      { id: "1", billNumber: "SI-8", amount: "1020.00", items: [{ purchaseOrderItemId: "b", qty: "2", unitPrice: "510" }] },
      { id: "2", billNumber: "SI-9", amount: "1560.00", items: [{ purchaseOrderItemId: "b", qty: "3", unitPrice: "520" }] },
    ]).lines[0]!;
    expect(mixed.mixedBilledPrices).toBe(true);
    expect(mixed.unitPriceDifference).toBe("16.00");
    expect(mixed.priceDifferenceTotal).toBe("80.00");
    expect(priceDifferenceText(mixed)!.perUnit).toBe("+₱16.00 / pc (average)");
    // Nothing billed on the line: no price text.
    expect(threeWayMatch([po[1]!], []).lines[0]!.unitPriceDifference).toBeNull();
    expect(priceDifferenceText(threeWayMatch([po[1]!], []).lines[0]!)).toBeNull();
  });

  it("lists every problem on a line: qty and price together, not just the price mismatch", () => {
    const partial = [{ ...po[0]!, receivedQty: "6.00" }];
    const m = threeWayMatch(partial, [{ id: "1", billNumber: "SI-10", amount: "364000.00", items: [{ purchaseOrderItemId: "a", qty: "8", unitPrice: "45500" }] }]);
    const l = m.lines[0]!;
    expect(l.flags).toEqual(["BILLED_MORE_THAN_RECEIVED", "RECEIVED_LESS_THAN_ORDERED", "PRICE_DIFFERS"]);
    expect(l.issues).toEqual(["QTY_MISMATCH", "PRICE_MISMATCH"]);
    expect(l.status).toBe("PRICE_MISMATCH");
    expect(l.unitPriceDifference).toBe("500.00");
  });

  it("flags billing less than received (qty only) and has no issues on a matched line", () => {
    const m = threeWayMatch(po, [{ id: "1", billNumber: "SI-11", amount: "452000.00", items: [{ purchaseOrderItemId: "a", qty: "10", unitPrice: "45000" }, { purchaseOrderItemId: "b", qty: "4", unitPrice: "500" }] }]);
    expect(m.lines[0]!.issues).toEqual([]);
    expect(m.lines[0]!.status).toBe("MATCHED");
    expect(m.lines[1]!.flags).toEqual(["BILLED_LESS_THAN_RECEIVED"]);
    expect(m.lines[1]!.issues).toEqual(["QTY_MISMATCH"]);
    expect(m.lines[1]!.status).toBe("QTY_MISMATCH");
  });

  it("an exact-match total-only bill is matched, with no line bill flags", () => {
    // PO 10 × 100, fully received, a 1,000 bill with no line items.
    const one = [{ id: "c", description: "Cable", unit: "pc", qty: "10.00", unitCost: "100.00", receivedQty: "10.00" }];
    const m = threeWayMatch(one, [{ id: "1", billNumber: "SI-12", amount: "1000.00", items: [] }]);
    expect(m.status).toBe("MATCHED");
    expect(m.headerFlags).toEqual([]);
    expect(m.lines[0]!.flags).toEqual([]);
    expect(m.lines[0]!.issues).toEqual([]);
    expect(m.lines[0]!.status).toBe("MATCHED");
    // A total-only bill that is off is caught by the total check only.
    const off = threeWayMatch(one, [{ id: "1", billNumber: "SI-13", amount: "900.00", items: [] }]);
    expect(off.status).toBe("MISMATCH");
    expect(off.headerFlags.map((f) => f.code)).toEqual(["BILLED_DIFFERS_FROM_RECEIVED"]);
    expect(off.lines[0]!.flags).toEqual([]);
  });

  it("a PO with no bills shows no bill flags", () => {
    const m = threeWayMatch(po, []);
    expect(m.status).toBe("NOT_BILLED");
    expect(m.headerFlags).toEqual([]);
    for (const l of m.lines) {
      expect(l.flags).toEqual([]);
      expect(l.issues).toEqual([]);
      expect(l.status).toBe("MATCHED");
    }
    // Received < ordered is still shown; it is not a bill flag.
    const partial = threeWayMatch([{ ...po[0]!, receivedQty: "6.00" }], []);
    expect(partial.lines[0]!.flags).toEqual(["RECEIVED_LESS_THAN_ORDERED"]);
  });

  it("matches a header-only bill against the received value; not billed when no bills", () => {
    expect(threeWayMatch(po, []).status).toBe("NOT_BILLED");
    const m = threeWayMatch(po, [{ id: "1", billNumber: "SI-4", amount: "452500.00", items: [] }]);
    expect(m.headerFlags).toEqual([]);
    expect(m.billedTotal).toBe("452500.00");
  });
});

describe("PO / RR numbering", () => {
  it("formats PO-YYYY-#### and RR-YYYY-#### from the defaults", () => {
    expect(formatDocNumber(DEFAULT_SETTINGS.numbering.supplierPo, 2026, 1)).toBe("PO-2026-0001");
    expect(formatDocNumber(DEFAULT_SETTINGS.numbering.receivingReport, 2026, 42)).toBe("RR-2026-0042");
    expect(NUMBERED_DOCS.map((d) => d.key)).toContain("receivingReport");
  });

  it("resets yearly (one counter per year) unless turned off", () => {
    expect(seriesYear(DEFAULT_SETTINGS.numbering.receivingReport, 2027)).toBe(2027);
    expect(seriesYear({ ...DEFAULT_SETTINGS.numbering.receivingReport, resetYearly: false }, 2027)).toBe(0);
  });

  it("allocates the next number from the locked series row", async () => {
    const calls: string[] = [];
    const tx = {
      $queryRaw: async (strings: TemplateStringsArray) => {
        calls.push(strings.join("?"));
        return [{ id: "s1", nextNumber: 7 }];
      },
      $executeRaw: async () => 1,
    } as never;
    expect(await allocateDocNumber(tx, "RECEIVING_REPORT", 2026, DEFAULT_SETTINGS.numbering.receivingReport)).toBe("RR-2026-0007");
    expect(calls[0]).toMatch(/FOR UPDATE/);
  });

  it("fills receivingReport into an older settings snapshot that lacks it", async () => {
    const old = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    delete old.numbering.receivingReport;
    old.numbering.supplierPo.prefix = "SPO";
    const rec: SettingsVersionRecord = { id: "v1", version: 1, data: old, changedKey: null, before: null, after: null, effectiveFrom: new Date(), createdById: null };
    const store: SettingsStore = { latest: async () => rec, byId: async () => rec, create: async () => rec };
    const snap = await getSettingsSnapshot(store);
    expect(snap.settings.numbering.receivingReport).toEqual({ prefix: "RR", padding: 4, resetYearly: true });
    expect(snap.settings.numbering.supplierPo.prefix).toBe("SPO");
  });
});

describe("cost stripping of PO / RR payloads", () => {
  const staff = { ...roleFlags(["STAFF"]), active: true, canSeeCosts: false };
  it("removes unit costs from anything that still carries them", () => {
    const payload = { number: "PO-2026-0001", lines: [{ description: "Laptop", qty: "10.00", unitCost: "45000.00", supplierId: "s1" }] };
    expect(stripCosts(payload, staff)).toEqual({ number: "PO-2026-0001", lines: [{ description: "Laptop", qty: "10.00" }] });
  });
});

describe("PO print", () => {
  it("renders the A4 PO with NON-VAT, supplier block, deliver-to — no selling prices or margins", () => {
    const html = renderToStaticMarkup(createElement(ProfessionalPrintDocument, { doc: poPrintFixture() }));
    for (const s of ["NON-VAT", "Purchase Order", "PO-2026-0001", "UNO Computer Supply", "TIN 000-333-444-000", "Deliver to", "₱400,000.00"]) {
      expect(html, s).toContain(s);
    }
    const lower = html.toLowerCase();
    for (const w of ["margin", "contract price", "unit price", "tesda"]) expect(lower, w).not.toContain(w);
  });

  it("shows DRAFT watermark on draft POs", () => {
    expect(renderToStaticMarkup(createElement(ProfessionalPrintDocument, { doc: draftPoFixture() }))).toContain("DRAFT");
  });

  it("flags missing company TIN and address for the toolbar warning", () => {
    expect(missingCompanyPrintFields({ name: "HACIEN", tin: "123-456-789-000", address: "QC", tradeName: "", phone: "", email: "", website: "", logoStorageKey: "" })).toEqual([]);
    expect(missingCompanyPrintFields({ name: "HACIEN", tin: "", address: " ", tradeName: "", phone: "", email: "", website: "", logoStorageKey: "" })).toEqual(["TIN", "address"]);
    expect(missingCompanyPrintFields({ name: "HACIEN", tin: "", address: "QC", tradeName: "", phone: "", email: "", website: "", logoStorageKey: "" })).toEqual(["TIN"]);
  });
});
