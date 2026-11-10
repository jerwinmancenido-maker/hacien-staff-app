import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireCostPage } from "@/lib/auth/current-user";
import { getCreatePosPreview } from "@/lib/purchasing/views";
import { isoDate, manilaToday } from "@/lib/format";
import { toScaled } from "@/lib/quotes/calc";
import { EmptyState, PageHeader } from "@/components/ui";
import { CreatePosForm } from "@/components/purchasing/CreatePosForm";
import { createPosFromSalesOrderAction } from "../../../purchase-orders/actions";

function openRowCount(lines: { isLot?: boolean; remainingQty: string; components?: { remainingQty: string }[] }[]): number {
  let n = 0;
  for (const line of lines) {
    if (line.isLot) {
      for (const c of line.components ?? []) if (toScaled(c.remainingQty, 2) > 0n) n += 1;
    } else if (toScaled(line.remainingQty, 2) > 0n) n += 1;
  }
  return n;
}

export default async function CreatePosPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireCostPage("edit_data");
  if (!user.isAdmin) redirect("/no-access");
  const { id } = await params;
  const so = await getCreatePosPreview(id, user);
  if (!so) notFound();
  const blocked = so.status !== "OPEN" ? "POs can only be created from an open sales order." : so.quoteStatus !== "WON" ? "The sales order's quote isn't Won." : null;
  const open = openRowCount(so.lines);
  return (
    <>
      {blocked || open === 0 ? (
        <>
          <PageHeader
            title={`Create POs · ${so.number}`}
            subtitle={`${so.customerName}. Tick items to order · supplier from quote (changeable) · costs stay as quoted · drafts only.`}
            actions={
              <Link className="btn btn-secondary" href={`/sales-orders/${id}`}>
                Back to sales order
              </Link>
            }
          />
          <div className="card">
            <EmptyState title={blocked ? "Can't create POs" : "All lines are on POs"} line={blocked ?? "Every open line of this sales order is already fully ordered. Void a PO to free its quantity."} />
          </div>
        </>
      ) : (
        <CreatePosForm
          soNumber={so.number}
          customerName={so.customerName}
          lines={so.lines}
          suppliers={so.suppliers}
          defaultDate={isoDate(manilaToday())}
          defaultAddress={so.deliveryAddress ?? ""}
          action={createPosFromSalesOrderAction.bind(null, id)}
          cancelHref={`/sales-orders/${id}`}
        />
      )}
    </>
  );
}
