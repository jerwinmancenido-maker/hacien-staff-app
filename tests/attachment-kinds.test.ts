// REQ-ATTACH-001: kind labels for SO/PO attachment files + source pins for
// the gates the plan locks (upload permissions, VOID refusals, the PO
// download cost gate, the delete guard's non-archived-only count).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ATTACHMENT_KIND_LABELS,
  PURCHASE_ORDER_ATTACHMENT_KINDS,
  SALES_ORDER_ATTACHMENT_KINDS,
  attachmentKindLabel,
  isAttachmentKind,
  pickedAttachmentKind,
} from "@/lib/attachment-kinds";

const root = process.cwd();
const src = (p: string) => readFileSync(join(root, p), "utf8");

describe("attachment kind labels", () => {
  it("maps the three codes to their display labels", () => {
    expect(ATTACHMENT_KIND_LABELS).toEqual({
      CUSTOMER_PO: "Customer PO",
      SUPPLIER_QUOTE: "Supplier quote",
      OTHER: "Other",
    });
    expect(attachmentKindLabel("CUSTOMER_PO")).toBe("Customer PO");
    expect(attachmentKindLabel("SUPPLIER_QUOTE")).toBe("Supplier quote");
    expect(attachmentKindLabel("OTHER")).toBe("Other");
  });

  it("reads an unknown or empty kind as Other", () => {
    expect(attachmentKindLabel(null)).toBe("Other");
    expect(attachmentKindLabel(undefined)).toBe("Other");
    expect(attachmentKindLabel("WHATEVER")).toBe("Other");
  });

  it("the SO form offers Customer PO + Other; the PO form offers Supplier quote + Other", () => {
    expect([...SALES_ORDER_ATTACHMENT_KINDS]).toEqual(["CUSTOMER_PO", "OTHER"]);
    expect([...PURCHASE_ORDER_ATTACHMENT_KINDS]).toEqual(["SUPPLIER_QUOTE", "OTHER"]);
  });

  it("a pick counts only when that form offers it", () => {
    expect(pickedAttachmentKind("CUSTOMER_PO", SALES_ORDER_ATTACHMENT_KINDS)).toBe("CUSTOMER_PO");
    expect(pickedAttachmentKind("SUPPLIER_QUOTE", SALES_ORDER_ATTACHMENT_KINDS)).toBeNull();
    expect(pickedAttachmentKind("SUPPLIER_QUOTE", PURCHASE_ORDER_ATTACHMENT_KINDS)).toBe("SUPPLIER_QUOTE");
    expect(pickedAttachmentKind("CUSTOMER_PO", PURCHASE_ORDER_ATTACHMENT_KINDS)).toBeNull();
    expect(pickedAttachmentKind("", SALES_ORDER_ATTACHMENT_KINDS)).toBeNull();
    expect(pickedAttachmentKind(null, SALES_ORDER_ATTACHMENT_KINDS)).toBeNull();
    expect(isAttachmentKind("OTHER")).toBe(true);
    expect(isAttachmentKind("other")).toBe(false);
  });
});

describe("REQ-ATTACH-001 gate pins", () => {
  it("SO upload is edit_data-gated, refuses VOID orders, and files under the sales order", () => {
    const actions = src("src/app/(app)/sales-orders/actions.ts");
    expect(actions).toContain("uploadSalesOrderAttachmentsAction");
    expect(actions).toContain('requireActionPermission("edit_data")');
    expect(actions).toContain('so.status === "VOID"');
    expect(actions).toContain("{ salesOrderId: id }");
  });

  it("PO upload is cost-gated, refuses VOID orders, and files under the purchase order", () => {
    const actions = src("src/app/(app)/purchase-orders/actions.ts");
    expect(actions).toContain("uploadPurchaseOrderAttachmentsAction");
    expect(actions).toContain('requireCostAction("edit_data")');
    expect(actions).toContain('po.status === "VOID"');
    expect(actions).toContain("{ purchaseOrderId: id }");
  });

  it("PO attachment downloads require costs, and the download audit names both new owners", () => {
    const download = src("src/lib/attachments-download.ts");
    expect(download).toContain("att.purchaseOrderId && !canSeeCosts(user)");
    expect(download).toContain("salesOrderId: att.salesOrderId");
    expect(download).toContain("purchaseOrderId: att.purchaseOrderId");
  });

  it("the SO delete guard counts only non-archived attachments (deliberate divergence)", () => {
    const del = src("src/lib/services/document-delete.ts");
    expect(del).toContain("where: { salesOrderId: id, archivedAt: null }");
  });

  it("archiving is Admin-gated in the action and the service", () => {
    expect(src("src/app/(app)/attachments/actions.ts")).toContain("assertCanDeleteDocument");
    expect(src("src/lib/services/attachments.ts")).toContain("assertCanDeleteDocument");
    expect(src("src/lib/services/attachments.ts")).toContain('action: "archive"');
  });

  it("the schema carries the two owner columns and the kind label", () => {
    const schema = src("prisma/schema.prisma");
    expect(schema).toContain("salesOrderId              String?");
    expect(schema).toContain("purchaseOrderId           String?");
    expect(schema).toContain("@@index([salesOrderId])");
    expect(schema).toContain("@@index([purchaseOrderId])");
  });
});
