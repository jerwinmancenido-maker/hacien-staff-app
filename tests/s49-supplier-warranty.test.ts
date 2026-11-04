// S-49: supplier warranty end date per receiving line.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { receiptInputSchema } from "@/lib/validation/purchasing";

const src = (p: string) => readFileSync(p, "utf8");

describe("S-49 warranty end date input", () => {
  const base = { receivedDate: "2026-11-04", receivedById: "u1", deliveryRef: "", notes: "" };

  it("accepts a YYYY-MM-DD warranty end, blank, or an omitted key", () => {
    const ok = receiptInputSchema.safeParse({
      ...base,
      lines: [
        { lineId: "l1", qty: "1", warrantyEndDate: "2027-11-04" },
        { lineId: "l2", qty: "1", warrantyEndDate: "" },
        { lineId: "l3", qty: "1" },
      ],
    });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.lines[0]?.warrantyEndDate).toBe("2027-11-04");
      expect(ok.data.lines[1]?.warrantyEndDate).toBeNull();
      expect(ok.data.lines[2]?.warrantyEndDate).toBeUndefined();
    }
  });

  it("rejects a non-date warranty end", () => {
    const bad = receiptInputSchema.safeParse({
      ...base,
      lines: [{ lineId: "l1", qty: "1", warrantyEndDate: "soon" }],
    });
    expect(bad.success).toBe(false);
  });
});

describe("S-49 UI + views", () => {
  it("receiving form posts a warranty date per line", () => {
    const s = src("src/components/purchasing/ReceiveForm.tsx");
    expect(s).toContain("warrantyEndDate: warranty[l.id]");
    expect(s).toContain('aria-label={`Supplier warranty until: ${l.description}`}');
  });

  it("receiving reports show the warranty end per line", () => {
    expect(src("src/components/purchasing/RrTable.tsx")).toContain("Supplier warranty until {day(x.warrantyEndDate)}");
    expect(src("src/lib/purchasing/views.ts")).toContain("warrantyEndDate: ymd(x.warrantyEndDate)");
  });

  it("migration adds the column, additive only", () => {
    const sql = src("prisma/migrations/20261104210000_s49_warranty_end/migration.sql");
    expect(sql).toContain("ALTER TABLE `ReceivingReportItem` ADD COLUMN `warrantyEndDate`");
    expect(sql).not.toMatch(/DROP|RENAME/i);
  });
});
