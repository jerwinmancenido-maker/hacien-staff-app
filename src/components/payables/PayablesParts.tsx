import { Chip, type ChipTone } from "@/components/ui";
import type { SupplierBillStatus, SupplierPaymentRequestStatus, SupplierPaymentStatus } from "@prisma/client";
import { PAYMENT_STATUS_LABELS, SUPPLIER_2307_STATUS_LABELS, SUPPLIER_BILL_STATUS_LABELS } from "@/lib/payables/views";
import { PAYMENT_REQUEST_STATUS_LABELS } from "@/lib/payables/payment-requests";
import { PAYMENT_METHOD_LABELS, type PaymentMethodInput } from "@/lib/validation/payables";

const BILL_TONES: Record<SupplierBillStatus, ChipTone> = {
  RECORDED: "blue",
  PARTIALLY_PAID: "blue",
  PAID: "green",
  VOID: "red",
};

export function SupplierBillStatusChip({ status }: { status: SupplierBillStatus }) {
  return <Chip tone={BILL_TONES[status]}>{SUPPLIER_BILL_STATUS_LABELS[status]}</Chip>;
}

const REQUEST_TONES: Record<SupplierPaymentRequestStatus, ChipTone> = {
  PENDING: "blue",
  APPROVED: "green",
  REJECTED: "red",
  PAID: "green",
  CANCELLED: "grey",
};

export function PaymentRequestStatusChip({ status }: { status: SupplierPaymentRequestStatus }) {
  return <Chip tone={REQUEST_TONES[status]}>{PAYMENT_REQUEST_STATUS_LABELS[status]}</Chip>;
}

export function PaymentStatusChip({ status }: { status: SupplierPaymentStatus }) {
  return <Chip tone={status === "VOID" ? "red" : "green"}>{PAYMENT_STATUS_LABELS[status]}</Chip>;
}

export function PaymentMethodLabel({ method }: { method: PaymentMethodInput | string }) {
  return <>{PAYMENT_METHOD_LABELS[method as PaymentMethodInput] ?? method}</>;
}

export function Supplier2307StatusChip({ status }: { status: "TO_ISSUE" | "ISSUED" }) {
  return <Chip tone={status === "ISSUED" ? "green" : "grey"}>{SUPPLIER_2307_STATUS_LABELS[status]}</Chip>;
}

/** Record-keeping disclaimer — never call these Official Receipts or Invoices. */
export const PAYABLES_DISCLAIMER = "Bank payment record (not an official receipt)";
