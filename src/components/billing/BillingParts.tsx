import { Chip, type ChipTone } from "@/components/ui";
import { BILLING_DISCLAIMER } from "@/lib/print/tax-wording";
import type { BillingStatus, CollectionStatus } from "@prisma/client";
import { BILLING_STATUS_LABELS, COLLECTION_STATUS_LABELS } from "@/lib/billing/views";
import { COLLECTION_METHOD_LABELS, type CollectionMethodInput } from "@/lib/validation/billing";

const BILLING_TONES: Record<BillingStatus, ChipTone> = {
  OPEN: "blue",
  PARTIALLY_PAID: "blue",
  PAID: "green",
  VOID: "red",
};

export function BillingStatusChip({ status }: { status: BillingStatus }) {
  return <Chip tone={BILLING_TONES[status]}>{BILLING_STATUS_LABELS[status]}</Chip>;
}

export function CollectionStatusChip({ status }: { status: CollectionStatus }) {
  return <Chip tone={status === "VOID" ? "red" : "green"}>{COLLECTION_STATUS_LABELS[status]}</Chip>;
}

export function MethodLabel({ method }: { method: CollectionMethodInput | string }) {
  return <>{COLLECTION_METHOD_LABELS[method as CollectionMethodInput] ?? method}</>;
}

/** Red "Overdue N days" badge when balance > 0 past due (+ grace). */
export function OverdueBadge({ label }: { label: string | null | undefined }) {
  if (!label) return null;
  return <Chip tone="red">{label}</Chip>;
}

/** On-screen billing disclaimer — the ONE canonical billing text
 * (BILLING_DISCLAIMER, BIR-WORDING.md rule 2), shared with the print
 * surfaces. Kept under this name for the billing / collection pages. */
export const PRINTABLE_DISCLAIMER = BILLING_DISCLAIMER;
