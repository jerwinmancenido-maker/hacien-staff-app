import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCostPage } from "@/lib/auth/current-user";
import { getCreatePosPreview } from "@/lib/purchasing/views";
import { isoDate, manilaToday } from "@/lib/format";
import { EmptyState, PageHeader } from "@/components/ui";
import { CreatePosForm } from "@/components/purchasing/CreatePosForm";
import { createPosFromSalesOrderAction } from "../../../purchase-orders/actions";

export default async function CreatePosPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireCostPage("edit_data");
  const { id } = await params;
  const so = await getCreatePosPreview(id, user);
  if (!so) notFound();
  const blocked = so.status !== "OPEN" ? "POs can only be created from an open sales order." : so.quoteStatus !== "WON" ? "The sales order's quote isn't Won." : null;
  const open = so.lines.filter((l) => !l.purchaseOrder).length;
  return (
    <>
      <PageHeader
        title={`Create POs · ${so.number}`}
        subtitle={`${so.customerName}. One draft PO per supplier; unit costs come from the sales order lines.`}
        actions={
          <Link className="btn btn-secondary" href={`/sales-orders/${id}`}>
            Back to sales order
          </Link>
        }
      />
      {blocked || open === 0 ? (
        <div className="card">
          <EmptyState title={blocked ? "Can't create POs" : "All lines are on POs"} line={blocked ?? "Every line of this sales order is already on a PO. Void a PO to free its lines."} />
        </div>
      ) : (
        <CreatePosForm
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
