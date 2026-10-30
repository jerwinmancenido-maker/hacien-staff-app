// Documents tab on customer and supplier pages (server component): loads the
// owner's business documents and hands plain rows to the client table.

import { db } from "@/lib/db";
import { formatDate, formatDateTime, manilaToday } from "@/lib/format";
import { expiryLabel, expiryStatus } from "@/lib/business-docs/expiry";
import { uploadMaxMb } from "@/lib/business-docs/sniff";
import { businessDocLabel } from "@/lib/business-docs/types";
import { listBusinessDocuments, type DocOwner } from "@/lib/services/business-documents";
import { BusinessDocuments, type BusinessDocRow } from "./BusinessDocuments";

const day = (d: Date | null) => (d ? formatDate(d) : null);

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export async function DocumentsTab({
  owner,
  canEdit,
  showArchived,
  warnDays,
}: {
  owner: DocOwner;
  canEdit: boolean;
  showArchived: boolean;
  warnDays: number;
}) {
  const today = manilaToday();
  const docs = await listBusinessDocuments(owner, { includeArchived: showArchived });
  const archivedCount = await db.businessDocument.count({
    where: { ...(owner.kind === "customer" ? { customerId: owner.id } : { supplierId: owner.id }), archivedAt: { not: null } },
  });
  const base = `/${owner.kind === "customer" ? "customers" : "suppliers"}/${owner.id}?tab=documents`;
  const rows: BusinessDocRow[] = docs.map((d) => {
    const status = expiryStatus(d.expiryDate, today, warnDays);
    return {
      id: d.id,
      type: d.type,
      typeLabel: businessDocLabel(d),
      docNumber: d.docNumber,
      issueDate: day(d.issueDate),
      expiryDate: day(d.expiryDate),
      expiry: { ...status, label: expiryLabel(status) },
      fileName: d.fileName,
      sizeLabel: sizeLabel(d.sizeBytes),
      uploadedBy: d.uploadedBy.name,
      uploadedAt: formatDateTime(d.createdAt),
      archived: !!d.archivedAt,
    };
  });
  return (
    <BusinessDocuments
      docs={rows}
      ownerKind={owner.kind}
      ownerId={owner.id}
      canEdit={canEdit}
      maxMb={uploadMaxMb()}
      showArchived={showArchived}
      archivedHref={showArchived ? base : `${base}&archived=1`}
      archivedCount={archivedCount}
    />
  );
}
