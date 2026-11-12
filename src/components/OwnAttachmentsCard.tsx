// REQ-ATTACH-001: a document's OWN attached files (sales order / purchase
// order), as distinct from the AttachmentsTab roll-up of related documents'
// files. Server component; the upload form and the per-file Remove button
// are the client pieces.
import { formatDate } from "@/lib/format";
import type { AttachmentKind } from "@/lib/attachment-kinds";
import type { FormState } from "@/lib/validation/forms";
import { AttachmentArchiveButton } from "./AttachmentArchiveButton";
import { AttachmentUploadForm } from "./AttachmentUploadForm";

export type OwnAttachmentFile = {
  id: string;
  fileName: string;
  sizeBytes: number;
  kindLabel: string;
  uploadedBy: string;
  createdAt: Date;
};

export function OwnAttachmentsCard({
  title,
  emptyText,
  files,
  canArchive,
  archiveAction,
  upload,
}: {
  title: string;
  emptyText: string;
  files: OwnAttachmentFile[];
  /** Admins only: show the per-file Remove (archive) button. */
  canArchive: boolean;
  archiveAction: (attachmentId: string) => Promise<FormState>;
  /** Null hides the upload form (no edit rights, or the document is void). */
  upload: {
    action: (s: FormState, f: FormData) => Promise<FormState>;
    kinds: readonly AttachmentKind[];
    idPrefix: string;
  } | null;
}) {
  return (
    <div className="card">
      <div className="card-head">
        <h2>{title}</h2>
      </div>
      {files.length === 0 ? (
        <p className="faint">{emptyText}</p>
      ) : (
        <ul className="list-plain">
          {files.map((f) => (
            <li key={f.id}>
              <a href={`/files/attachments/${f.id}`} target="_blank" rel="noreferrer">
                {f.fileName}
              </a>{" "}
              <span className="chip dark">{f.kindLabel}</span>
              <span className="faint small">
                {" "}
                {Math.max(1, Math.round(f.sizeBytes / 1024))} KB · {f.uploadedBy} · {formatDate(f.createdAt)}
              </span>{" "}
              {canArchive && <AttachmentArchiveButton fileName={f.fileName} action={archiveAction.bind(null, f.id)} />}
            </li>
          ))}
        </ul>
      )}
      {upload && <AttachmentUploadForm action={upload.action} kinds={upload.kinds} idPrefix={upload.idPrefix} />}
    </div>
  );
}
