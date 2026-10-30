import { notFound, redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { getReceivingView } from "@/lib/purchasing/views";
import { uploadMaxMb } from "@/lib/business-docs/sniff";
import { isoDate, manilaToday } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { ReceiveForm } from "@/components/purchasing/ReceiveForm";
import { postReceivingReportAction } from "../../actions";

// Staff with edit_data can receive without cost access: no prices on this page.
export default async function ReceiveItemsPage({ params }: { params: Promise<{ poId: string }> }) {
  const user = await requirePagePermission("edit_data");
  const { poId } = await params;
  const po = await getReceivingView(poId, user);
  if (!po) notFound();
  if (!po.canReceive) redirect(`/receiving/${poId}`);
  const users = await db.user.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  return (
    <>
      <PageHeader title={`Receive items · ${po.number}`} subtitle={`${po.supplier.name}. Enter what arrived; leave 0 for lines that didn't.`} />
      <ReceiveForm
        lines={po.lines}
        users={users}
        defaultUserId={user.id}
        defaultDate={isoDate(manilaToday())}
        action={postReceivingReportAction.bind(null, poId)}
        cancelHref={`/receiving/${poId}`}
        maxMb={uploadMaxMb()}
      />
    </>
  );
}
