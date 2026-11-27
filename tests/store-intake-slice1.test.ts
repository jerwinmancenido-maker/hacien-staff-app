import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { API_SCOPE_VALUES, hasScope, sanitizeScopes } from "@/lib/api/scopes";
import { AUDIT_ENTITIES, AUDIT_ENTITY_LABELS } from "@/lib/audit-log";
import { storeOrderConfirmationEmail } from "@/lib/email-templates";
import { DEFAULT_SETTINGS } from "@/lib/settings/defaults";
import { emailIdentity } from "@/lib/settings/identity";
import { storeOrderDisplayStatus } from "@/lib/store-orders/views";

/**
 * Store intake Slice 1 — source + pure-function pins: the new API scope is
 * registered (unknown scopes are dropped by sanitizeScopes, so an
 * unregistered scope could never be granted), the WO numbering default,
 * the audit entity, the Sidebar/bell wiring, and the derived DONE status.
 */

const read = (rel: string) => readFileSync(path.resolve(__dirname, "..", rel), "utf8");

describe("store-orders:write scope", () => {
  it("is registered and survives sanitizing", () => {
    expect(API_SCOPE_VALUES).toContain("store-orders:write");
    expect(sanitizeScopes(["store-orders:write"])).toEqual(["store-orders:write"]);
    expect(hasScope(["store-orders:write"], "store-orders:write")).toBe(true);
    expect(hasScope(["items:read"], "store-orders:write")).toBe(false);
    expect(hasScope(["write"], "store-orders:write")).toBe(true);
  });
});

describe("WO numbering default", () => {
  it("seeds prefix WO, padding 4, yearly reset — the 10th numbering entry", () => {
    expect(DEFAULT_SETTINGS.numbering.storeOrder).toEqual({ prefix: "WO", padding: 4, resetYearly: true });
    expect(Object.keys(DEFAULT_SETTINGS.numbering)).toHaveLength(10);
  });
});

describe("audit wiring", () => {
  it("StoreOrder is an auditable entity with a label", () => {
    expect(AUDIT_ENTITIES).toContain("StoreOrder");
    expect(AUDIT_ENTITY_LABELS.StoreOrder).toBe("Store order");
  });
});

describe("inbox wiring", () => {
  it("Sidebar carries the Store Orders entry, its crumb label and the badge", () => {
    const dq = String.fromCharCode(34);
    const sidebar = read("src/components/Sidebar.tsx");
    expect(sidebar).toContain(`href: ${dq}/store-orders${dq}`);
    expect(sidebar).toContain(`${dq}store-orders${dq}: ${dq}Store Orders${dq}`);
    expect(sidebar).toContain("storeOrdersPaidCount");
    expect(sidebar).toContain("nav-badge");
  });

  it("the bell gains a store-orders section from the shared views helper", () => {
    const notifications = read("src/lib/notifications.ts");
    const dq = String.fromCharCode(34);
    expect(notifications).toContain(`key: ${dq}store-orders${dq}`);
    expect(notifications).toContain("storeOrderBellData");
  });

  it("the intake route is guarded by the scope, edit_data and required idempotency", () => {
    const route = read("src/app/api/v1/store-orders/route.ts");
    const dq = String.fromCharCode(34);
    expect(route).toContain(`scope: ${dq}store-orders:write${dq}`);
    expect(route).toContain(`permission: ${dq}edit_data${dq}`);
    expect(route).toContain(`idempotency: ${dq}required${dq}`);
  });
});

describe("derived display status", () => {
  it("reads DONE only for a converted order whose SO is CLOSED", () => {
    expect(storeOrderDisplayStatus({ status: "CONFIRMED", salesOrder: { status: "CLOSED" } })).toBe("DONE");
    expect(storeOrderDisplayStatus({ status: "CONFIRMED", salesOrder: { status: "OPEN" } })).toBe("CONFIRMED");
    expect(storeOrderDisplayStatus({ status: "PAID", salesOrder: null })).toBe("PAID");
    expect(storeOrderDisplayStatus({ status: "REFUNDED", salesOrder: { status: "VOID" } })).toBe("REFUNDED");
  });
});

describe("confirmation email template", () => {
  it("carries the WO number, the paid total and no cost-side figures", () => {
    const draft = storeOrderConfirmationEmail(
      {
        buyerName: "Juan Dela Cruz",
        number: "WO-2026-0001",
        amountPaid: "1150.00",
        deliveryFee: "150.00",
        lines: [{ title: "Widget A", qty: "2.00", unit: "pc", unitPrice: "500.00", lineTotal: "1000.00" }],
      },
      emailIdentity(DEFAULT_SETTINGS),
    );
    expect(draft.subject).toContain("WO-2026-0001");
    expect(draft.text).toContain("Total paid: ₱1,150.00");
    expect(draft.text).toContain("Delivery fee — ₱150.00");
    expect(draft.text).toContain("2 pc × Widget A");
    expect(draft.html).toContain("WO-2026-0001");
    expect(draft.text).not.toContain("gateway fee");
  });

  it("omits the delivery row when no delivery fee was charged", () => {
    const draft = storeOrderConfirmationEmail(
      {
        buyerName: "Ana",
        number: "WO-2026-0002",
        amountPaid: "500.00",
        deliveryFee: "0.00",
        lines: [{ title: "Gadget", qty: "1.00", unit: "pc", unitPrice: "500.00", lineTotal: "500.00" }],
      },
      emailIdentity(DEFAULT_SETTINGS),
    );
    expect(draft.text).not.toContain("Delivery fee");
    expect(draft.html).not.toContain("Delivery fee");
  });
});
