"use client";

// Top-right of the quote page: one primary button for the next step, plus
// Actions ▾ (Edit, Print / Save PDF, Email, Convert to SO, Mark lost, Void).
// Viewers only get Print. The server re-checks every action.
//
// When withholding is not set on a draft, Mark as sent asks
// "No withholding on this quote?" — Yes, none / Pick rates.

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ActionsMenu, type MenuItem } from "./ActionsMenu";
import { ConvertDialog, EmailDialog, VoidDialog, type AddressOption, type EmailDraftView } from "./Dialogs";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  WITHHOLDING_NONE_CONFIRM_PICK,
  WITHHOLDING_NONE_CONFIRM_TITLE,
  WITHHOLDING_NONE_CONFIRM_YES,
} from "@/lib/quotes/withholding-defaults";
import type { FormState } from "@/lib/validation/forms";

type Props = {
  id: string;
  number: string;
  status: string;
  canEdit: boolean;
  /** An open sales order made from this quote, if any. */
  openSalesOrderId: string | null;
  /** Suggested delivery address (default delivery, else billing), editable in the dialog. */
  customerAddress: string;
  addressOptions?: AddressOption[];
  /** When true, Mark as sent shows the no-withholding confirm first. */
  withholdingNotSet?: boolean;
  actions: {
    markSent: (id: string) => Promise<FormState>;
    /** Saves explicit none then marks sent (Yes, none). */
    confirmNoneAndMarkSent?: (id: string) => Promise<FormState>;
    markLost: (id: string) => Promise<FormState>;
    void: (id: string, reason: string) => Promise<FormState>;
    convert: (id: string, input: { buyerPoNo: string; buyerPoDate: string; deliveryAddress: string }) => Promise<FormState>;
    email: (id: string) => Promise<FormState & { draft?: EmailDraftView }>;
    /** Draft/unsent only — refresh letterhead from current settings. */
    refreshCompanyDetails?: (id: string) => Promise<FormState>;
  };
};

export function QuoteActions({
  id,
  number,
  status,
  canEdit,
  openSalesOrderId,
  customerAddress,
  addressOptions,
  withholdingNotSet = false,
  actions,
}: Props) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"void" | "convert" | "lost" | "wh-none" | null>(null);
  const [draft, setDraft] = useState<EmailDraftView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [okMessage, setOkMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<FormState & { draft?: EmailDraftView }>) =>
    startTransition(async () => {
      const res = await fn();
      setMessage(res.ok ? null : (res.message ?? "Something went wrong."));
      setOkMessage(res.ok ? (res.message ?? null) : null);
      if (res.draft) setDraft(res.draft);
    });

  const editable = status === "DRAFT" || status === "SENT";
  /** Sent / WON / LOST / VOID keep a frozen company snapshot. */
  const canRefreshCompany = canEdit && status === "DRAFT" && !!actions.refreshCompanyDetails;
  const items: MenuItem[] = [];
  if (canEdit && editable) items.push({ key: "edit", label: "Edit", href: `/quotes/${id}/edit` });
  items.push({ key: "print", label: "Print / Save PDF", href: `/print/quotes/${id}`, newTab: true });
  if (canRefreshCompany) {
    items.push({
      key: "refresh-company",
      label: "Use latest company details",
      onSelect: () => run(() => actions.refreshCompanyDetails!(id)),
    });
  }
  if (canEdit && status !== "VOID") items.push({ key: "email", label: "Email", onSelect: () => run(() => actions.email(id)) });
  if (canEdit && editable) items.push({ key: "convert", label: "Convert to SO", onSelect: () => setDialog("convert") });
  if (canEdit && editable) items.push({ key: "lost", label: "Mark lost", danger: true, onSelect: () => setDialog("lost") });
  if (canEdit && status !== "VOID") items.push({ key: "void", label: "Void", danger: true, onSelect: () => setDialog("void") });

  function onMarkSent() {
    if (withholdingNotSet) {
      setDialog("wh-none");
      return;
    }
    run(() => actions.markSent(id));
  }

  let primary: React.ReactNode = null;
  if (status === "WON" && openSalesOrderId) {
    primary = (
      <Link className="btn" href={`/sales-orders/${openSalesOrderId}`}>
        Open sales order
      </Link>
    );
  } else if (canEdit && status === "DRAFT") {
    primary = (
      <button type="button" className="btn" disabled={pending} onClick={onMarkSent}>
        Mark as sent
      </button>
    );
  } else if (canEdit && status === "SENT") {
    primary = (
      <button type="button" className="btn" onClick={() => setDialog("convert")}>
        Convert to SO
      </button>
    );
  }

  return (
    <>
      {message && (
        <span role="alert" className="small" style={{ color: "var(--red)" }}>
          {message}
        </span>
      )}
      {okMessage && (
        <span role="status" className="small muted">
          {okMessage}
        </span>
      )}
      <ActionsMenu items={items} />
      {primary}
      {dialog === "void" && (
        <VoidDialog
          docLabel="quote"
          body={`${number} will be marked Void and become read-only. Its number is kept and never reused.`}
          onClose={() => setDialog(null)}
          onVoid={(reason) => actions.void(id, reason)}
        />
      )}
      {dialog === "convert" && (
        <ConvertDialog number={number} defaultAddress={customerAddress} addressOptions={addressOptions} onClose={() => setDialog(null)} onConvert={(input) => actions.convert(id, input)} />
      )}
      <ConfirmDialog
        open={dialog === "lost"}
        title={`Mark ${number} as lost?`}
        body="The quote becomes read-only."
        confirmLabel="Mark lost"
        danger
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          setDialog(null);
          run(() => actions.markLost(id));
        }}
      />
      <ConfirmDialog
        open={dialog === "wh-none"}
        title={WITHHOLDING_NONE_CONFIRM_TITLE}
        body="No rates are picked. Save as none, or go back and pick rates."
        confirmLabel={WITHHOLDING_NONE_CONFIRM_YES}
        cancelLabel={WITHHOLDING_NONE_CONFIRM_PICK}
        onCancel={() => {
          setDialog(null);
          router.push(`/quotes/${id}/edit`);
        }}
        onConfirm={() => {
          setDialog(null);
          const fn = actions.confirmNoneAndMarkSent ?? actions.markSent;
          run(() => fn(id));
        }}
      />
      {draft && <EmailDialog draft={draft} onClose={() => setDraft(null)} />}
    </>
  );
}

type SoProps = {
  id: string;
  number: string;
  status: string;
  canEdit: boolean;
  voidAction: (id: string, reason: string) => Promise<FormState>;
};

export function SalesOrderActions({ id, number, status, canEdit, voidAction }: SoProps) {
  const [voiding, setVoiding] = useState(false);
  const items: MenuItem[] = [];
  if (canEdit && status === "OPEN") items.push({ key: "edit", label: "Edit", href: `/sales-orders/${id}/edit` });
  items.push({ key: "print", label: "Print / Save PDF", href: `/print/sales-orders/${id}`, newTab: true });
  if (canEdit && status === "OPEN") items.push({ key: "void", label: "Void", danger: true, onSelect: () => setVoiding(true) });
  return (
    <>
      <ActionsMenu items={items} />
      {canEdit && status === "OPEN" && (
        <Link className="btn" href={`/sales-orders/${id}/edit`}>
          Edit order
        </Link>
      )}
      {voiding && (
        <VoidDialog
          docLabel="sales order"
          body={`${number} will be marked Void and its quote goes back to Sent. The number is kept and never reused.`}
          onClose={() => setVoiding(false)}
          onVoid={(reason) => voidAction(id, reason)}
        />
      )}
    </>
  );
}
