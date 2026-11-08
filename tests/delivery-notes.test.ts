import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseDeliveryForm } from "@/lib/validation/deliveries";

// Delivery notes (PR-B, test-3 friction A1): the form field, validation and
// persistence wiring. Behavior of the parse: trimmed, blank -> null, capped.
function form(extra: Record<string, string> = {}): FormData {
  const f = new FormData();
  f.set("drNumber", "DR123");
  f.set("deliveryDate", "2026-11-08");
  for (const [k, v] of Object.entries(extra)) f.set(k, v);
  return f;
}

describe("parseDeliveryForm notes", () => {
  it("trims and keeps a typed note", () => {
    const r = parseDeliveryForm(form({ notes: "  Gate pass under customer name  " }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.notes).toBe("Gate pass under customer name");
  });

  it("blank or absent notes become null", () => {
    const blank = parseDeliveryForm(form({ notes: "   " }));
    expect(blank.ok).toBe(true);
    if (blank.ok) expect(blank.data.notes).toBeNull();
    const absent = parseDeliveryForm(form());
    expect(absent.ok).toBe(true);
    if (absent.ok) expect(absent.data.notes ?? null).toBeNull();
  });

  it("rejects notes over 2000 characters", () => {
    const r = parseDeliveryForm(form({ notes: "x".repeat(2001) }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors.notes).toBeTruthy();
  });
});

describe("delivery notes wiring", () => {
  const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

  it("schema + migration carry the additive column", () => {
    const schema = read("prisma/schema.prisma");
    const start = schema.indexOf("model Delivery {");
    expect(schema.slice(start, start + 1200)).toContain("notes          String?          @db.Text");
    const migration = read("prisma/migrations/20261108223000_delivery_notes/migration.sql");
    expect(migration).toContain("ALTER TABLE `Delivery` ADD COLUMN `notes` TEXT NULL");
  });

  it("service stores notes and the form offers the field", () => {
    expect(read("src/lib/services/deliveries.ts")).toContain("notes: input.notes ?? null");
    const section = read("src/components/sales-orders/DeliverySection.tsx");
    expect(section).toContain('name="notes"');
    expect(section).toContain("d.notes");
  });
});
