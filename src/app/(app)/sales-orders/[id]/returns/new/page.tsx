import { notFound, redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { getSalesOrderView } from "@/lib/quotes/views";
import { isoDate, manilaToday } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { CustomerReturnForm } from "@/components/sales-orders/CustomerReturnForm";
import { postCustomerReturnAction } from "../../../actions";

// Audit D: return delivered goods. The returned value becomes customer
// credit that can be applied to an open billing. Allowed on OPEN and
// CLOSED orders (a closed order reopens when goods come back); void orders
// can't have returns.
export default async function NewCustomerReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("view");
  const { id } = await params;
  const so = await getSalesOrderView(id, user);
  if (!so) notFound();
  if (so.status === "VOID") redirect(`/sales-orders/${id}?tab=returns`);
  const lines = so.items.map((i) => ({
    id: i.id,
    description: i.description,
    unit: i.unit,
    orderedQty: i.qty,
    deliveredQty: i.deliveredQty ?? "0.00",
    unitPrice: i.unitPrice,
  }));
  return (
    <>
      <PageHeader
        title={`Record return · ${so.number}`}
        subtitle={`${so.customer.name}. Returned quantities come off what was delivered; the returned value becomes customer credit.`}
      />
      <CustomerReturnForm
        lines={lines}
        defaultDate={isoDate(manilaToday())}
        action={postCustomerReturnAction.bind(null, id)}
        cancelHref={`/sales-orders/${id}?tab=returns`}
      />
    </>
  );
}
