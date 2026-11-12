// REQ-ATTACH-001: the per-file label stored on DocumentAttachment.kind for
// files owned by a sales order or a purchase order. One shared spot so the
// upload forms, the detail pages and the tests all use the same codes and
// display labels. Files owned by anything else keep kind = null.

export const ATTACHMENT_KINDS = ["CUSTOMER_PO", "SUPPLIER_QUOTE", "OTHER"] as const;

export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export const ATTACHMENT_KIND_LABELS: Record<AttachmentKind, string> = {
  CUSTOMER_PO: "Customer PO",
  SUPPLIER_QUOTE: "Supplier quote",
  OTHER: "Other",
};

/** Kinds offered on the sales-order upload form. */
export const SALES_ORDER_ATTACHMENT_KINDS: readonly AttachmentKind[] = ["CUSTOMER_PO", "OTHER"];

/** Kinds offered on the purchase-order upload form. */
export const PURCHASE_ORDER_ATTACHMENT_KINDS: readonly AttachmentKind[] = ["SUPPLIER_QUOTE", "OTHER"];

export function isAttachmentKind(value: unknown): value is AttachmentKind {
  return typeof value === "string" && (ATTACHMENT_KINDS as readonly string[]).includes(value);
}

/** Display label for a stored kind; unknown or empty reads as "Other". */
export function attachmentKindLabel(kind: string | null | undefined): string {
  return isAttachmentKind(kind) ? ATTACHMENT_KIND_LABELS[kind] : ATTACHMENT_KIND_LABELS.OTHER;
}

/** The kind picked on an upload form, or null when the pick is not one of the kinds that form offers. */
export function pickedAttachmentKind(value: unknown, offered: readonly AttachmentKind[]): AttachmentKind | null {
  return isAttachmentKind(value) && offered.includes(value) ? value : null;
}
