import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { money } from "@/lib/documents/common";
import { getSettingsSnapshot } from "@/lib/settings";
import { dueDateFromTerms, billingToday } from "@/lib/billing/dates";
import { remainingToBill } from "@/lib/billing/status";
import { getBookletView } from "@/lib/billing/views";
import { isoDate } from "@/lib/format";
import { toScaled, type WithholdingSnapshot } from "@/lib/quotes/calc";
import { BillingNav } from "@/components/billing/BillingNav";
import { BillingForm } from "@/components/billing/BillingForm";
import { PageHeader } from "@/components/ui";
import { recordBillingAction } from "../../actions";

export default async function NewBillingPage({ searchParams }: { searchParams: Promise<{ salesOrderId?: string }> }) {
  const user = await requirePagePermission("view");
  if (!can(user, "manage_billing")) redirect("/no-access");
  const { salesOrderId } = await searchParams;
  if (!salesOrderId) {
    // Pick list of open SOs with remaining to bill.
    const sos = await db.salesOrder.findMany({
      where: { status: "OPEN" },
      include: { customer: { select: { name: true } }, billings: { where: { status: { not: "VOID" } }, select: { amount: true } } },
      orderBy: { date: "desc" },
      take: 100,
    });
    const open = sos
      .map((so) => ({
        id: so.id,
        number: so.number,
        customer: so.customer.name,
        remaining: remainingToBill(
          money(so.contractPrice),
          so.billings.map((b) => money(b.amount)),
        ),
      }))
      .filter((s) => toScaled(s.remaining, 2) > 0n);

    return (
      <>
        <PageHeader title="Record billing" subtitle="Pick an open sales order with remaining to bill." />
        <BillingNav active="billings" />
        <div className="card">
          {open.length === 0 ? (
            <p className="faint">No open sales orders with remaining to bill.</p>
          ) : (
            <ul className="plain-list">
              {open.map((s) => (
                <li key={s.id}>
                  <Link href={`/billing/billings/new?salesOrderId=${s.id}`}>
                    {s.number} · {s.customer}
                  </Link>{" "}
                  <span className="faint">— ₱{s.remaining} left</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </>
    );
  }

  const so = await db.salesOrder.findUnique({
    where: { id: salesOrderId },
    include: {
      customer: { select: { id: true, name: true } },
      billings: { where: { status: { not: "VOID" } }, select: { amount: true } },
    },
  });
  if (!so || so.status !== "OPEN") notFound();

  const remaining = remainingToBill(
    money(so.contractPrice),
    so.billings.map((b) => money(b.amount)),
  );
  if (toScaled(remaining, 2) <= 0n) {
    return (
      <>
        <PageHeader title="Record billing" subtitle={`${so.number} is fully billed.`} />
        <BillingNav active="billings" />
        <div className="alert">This sales order has nothing left to bill.</div>
      </>
    );
  }

  const snap = await getSettingsSnapshot();
  const booklet = await getBookletView();
  const today = billingToday();
  const due = dueDateFromTerms(today, so.terms);
  // Prefill amount = remaining; withholding snapshot exists on SO for later collections.
  void (so.withholding as WithholdingSnapshot[]);

  return (
    <>
      <PageHeader
        title="Record billing"
        subtitle={`${so.number} · ${so.customer.name} · remaining ₱${remaining}`}
      />
      <BillingNav active="billings" />
      <div className="card" style={{ maxWidth: 720 }}>
        <BillingForm
          action={recordBillingAction}
          canEdit
          salesOrderLabel={`${so.number} · ${so.customer.name}`}
          remaining={remaining}
          nextInvoiceHint={booklet.nextFree}
          seriesFrom={snap.settings.invoiceBooklet.seriesFrom}
          seriesTo={snap.settings.invoiceBooklet.seriesTo}
          defaults={{
            salesOrderId: so.id,
            amount: remaining,
            invoiceNo: booklet.nextFree != null ? String(booklet.nextFree) : "",
            invoiceDate: isoDate(today),
            dueDate: isoDate(due),
            notes: "",
          }}
        />
      </div>
    </>
  );
}
