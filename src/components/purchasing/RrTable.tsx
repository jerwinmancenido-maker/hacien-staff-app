// Receiving reports table (PO page and receiving page). Quantities only.

import type { FormState } from "@/lib/validation/forms";
import { VoidButton } from "./DocButtons";
import { AttachmentLinks, day, qtyText, RrStatusChip } from "./PoParts";

export function RrTable({
  reports,
  poId,
  canEdit,
  voidAction,
}: {
  reports: { id: string; number: string; status: string; receivedDate: string; receivedBy: string; deliveryRef: string | null; notes: string | null; voidReason: string | null; items: { description: string; qty: string }[]; attachments: { id: string; fileName: string; sizeBytes: number }[] }[];
  poId: string;
  canEdit: boolean;
  voidAction: (poId: string, id: string, reason: string) => Promise<FormState>;
}) {
  return (
    <div className="table-wrap">
      <table className="list" aria-label="Receiving reports">
        <thead>
          <tr>
            <th>RR no.</th>
            <th>Received</th>
            <th>Items</th>
            <th>DR no.</th>
            <th>Files</th>
            <th>Status</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {reports.map((r) => (
            <tr key={r.id} className={r.status === "VOID" ? "inactive" : undefined}>
              <td className="strong">{r.number}</td>
              <td>
                {day(r.receivedDate)}
                <div className="small muted">by {r.receivedBy}</div>
              </td>
              <td className="small">
                {r.items.map((x, n) => (
                  <div key={n}>
                    {x.description.split("\n")[0]}: <b>{qtyText(x.qty)}</b>
                  </div>
                ))}
                {r.notes && <div className="faint">{r.notes}</div>}
                {r.voidReason && <div className="faint">Void: {r.voidReason}</div>}
              </td>
              <td>{r.deliveryRef ?? <span className="faint">—</span>}</td>
              <td>
                <AttachmentLinks files={r.attachments} />
              </td>
              <td>
                <RrStatusChip status={r.status} />
              </td>
              <td>
                {canEdit && r.status === "POSTED" && (
                  <VoidButton
                    label="Void"
                    docLabel="receiving report"
                    body={`${r.number} will be marked Void and its quantities taken off the PO.`}
                    onVoid={voidAction.bind(null, poId, r.id)}
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
