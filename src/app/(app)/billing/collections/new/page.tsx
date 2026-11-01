import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { money } from "@/lib/documents/common";
import { billingToday } from "@/lib/billing/dates";
import { billingBalance } from "@/lib/billing/status";
import { isoDate } from "@/lib/format";
import { fromScaled, toScaled, type WithholdingSnapshot } from "@/lib/quotes/calc";
import { CASH_ACCOUNT_TYPE_LABELS } from "@/lib/cash/labels";
import { isCashEnabled } from "@/lib/cash/features";
import { defaultCashAccountId, listActiveCashAccounts } from "@/lib/services/cash-accounts";
import { BillingNav } from "@/components/billing/BillingNav";
import { CollectionForm, type OpenBillingRow } from "@/components/billing/CollectionForm";
import { PageHeader } from "@/components/ui";
import { recordCollectionAction } from "../../actions";

export default async function NewCollectionPage({ searchParams }: { searchParams: Promise<{ customerId?: string }> }) {
  const user = await requirePagePermission("view");
  if (!can(user, "manage_billing")) redirect("/no-access");
  const { customerId } = await searchParams;

  if (!customerId) {
    const customers = await db.customer.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      take: 200,
      select: { id: true, name: true },
    });
    return (
      <>
        <PageHeader title="Record collection" subtitle="Pick a customer." />
        <BillingNav active="collections" />
        <div className="card">
          <ul className="plain-list">
            {customers.map((c) => (
              <li key={c.id}>
                <Link href={`/billing/collections/new?customerId=${c.id}`}>{c.name}</Link>
              </li>
            ))}
          </ul>
        </div>
      </>
    );
  }

  const customer = await db.customer.findUnique({ where: { id: customerId } });
  if (!customer) notFound();

  const billings = await db.billing.findMany({
    where: { customerId, status: { in: ["OPEN", "PARTIALLY_PAID"] } },
    include: {
      allocations: { where: { collection: { status: "POSTED" } } },
      salesOrder: {
        select: {
          withholding: true,
          items: {
            where: { removedAt: null },
            select: { withholdingRate: true, withholdingAtc: true },
          },
        },
      },
    },
    orderBy: [{ dueDate: "asc" }, { invoiceDate: "asc" }],
  });

  const openBillings: OpenBillingRow[] = billings
    .map((b) => {
      const cash = b.allocations.reduce((a, x) => a + toScaled(money(x.cashApplied), 2), 0n);
      const wh = b.allocations.reduce((a, x) => a + toScaled(money(x.withholdingApplied), 2), 0n);
      const balance = billingBalance(money(b.amount), {
        cashApplied: fromScaled(cash, 2),
        withholdingApplied: fromScaled(wh, 2),
      });
      const snap = (b.salesOrder.withholding ?? []) as WithholdingSnapshot[];
      const fromSnap = snap
        .filter((s) => Number(s.rate) > 0)
        .map((s) => ({ rate: Number(s.rate).toFixed(4), atcCode: s.atcCode ?? null }));
      const fromLines = new Map<string, { rate: string; atcCode: string | null }>();
      let stackedNullAtc = false;
      for (const item of b.salesOrder.items) {
        if (item.withholdingRate == null || Number(item.withholdingRate) <= 0) continue;
        const atc = item.withholdingAtc?.trim() || null;
        if (!atc) {
          stackedNullAtc = true;
          continue;
        }
        const rate = Number(item.withholdingRate).toFixed(4);
        if (!fromLines.has(atc)) fromLines.set(atc, { rate, atcCode: atc });
      }
      // Explicit line ATCs when none are stacked-null; else snapshot (keeps stacked codes).
      const defaultCodes =
        fromLines.size > 0 && !stackedNullAtc ? [...fromLines.values()] : fromSnap.length > 0 ? fromSnap : [...fromLines.values()];
      return {
        id: b.id,
        invoiceNo: b.invoiceNo,
        number: b.number,
        dueDate: b.dueDate.toISOString().slice(0, 10),
        amount: money(b.amount),
        balance,
        defaultRate: defaultCodes[0]?.rate ?? snap[0]?.rate ?? "0.0000",
        defaultAtc: defaultCodes[0]?.atcCode ?? snap[0]?.atcCode ?? null,
        defaultCodes,
      };
    })
    .filter((b) => toScaled(b.balance, 2) > 0n);

  const today = billingToday();
  const cashOn = await isCashEnabled();
  const cashAccounts = cashOn ? await listActiveCashAccounts() : [];
  const defaultCash = cashOn ? await defaultCashAccountId() : null;

  return (
    <>
      <PageHeader title="Record collection" subtitle={customer.name} />
      <BillingNav active="collections" />
      <div className="card" style={{ maxWidth: 960 }}>
        <CollectionForm
          action={recordCollectionAction}
          canEdit
          canOverrideRates={user.isAdmin}
          customerId={customer.id}
          customerName={customer.name}
          openBillings={openBillings}
          cashEnabled={cashOn}
          cashAccounts={cashAccounts.map((a) => ({
            id: a.id,
            name: a.name,
            typeLabel: CASH_ACCOUNT_TYPE_LABELS[a.type],
            hint: a.accountHintLast4,
          }))}
          defaults={{
            date: isoDate(today),
            amountReceived: "",
            method: "CASH",
            receiptNo: "",
            cashAccountId: defaultCash ?? "",
          }}
        />
      </div>
    </>
  );
}
