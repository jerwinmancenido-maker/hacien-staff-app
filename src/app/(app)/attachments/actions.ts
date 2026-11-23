"use server";

import { revalidatePath } from "next/cache";
import { requireSignedInUser } from "@/lib/auth/current-user";
import { runAction } from "@/lib/actions";
import { assertCanDeleteDocument } from "@/lib/permissions";
import { archiveAttachment } from "@/lib/services/attachments";
import type { FormState } from "@/lib/validation/forms";

/**
 * REQ-ATTACH-001: remove (archive) a file from a sales order or purchase
 * order. Admin only — the service enforces the same gate. The row and the
 * stored file stay; the file just stops showing on the document.
 */
export async function archiveAttachmentAction(attachmentId: string): Promise<FormState> {
  return runAction(async () => {
    const user = await requireSignedInUser();
    assertCanDeleteDocument(user);
    const att = await archiveAttachment(attachmentId, user);
    if (att.salesOrderId) revalidatePath(`/sales-orders/${att.salesOrderId}`);
    if (att.purchaseOrderId) revalidatePath(`/purchase-orders/${att.purchaseOrderId}`);
    return { ok: true, message: "Attachment removed." };
  });
}
