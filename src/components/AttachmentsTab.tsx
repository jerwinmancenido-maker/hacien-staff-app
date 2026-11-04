/** S-56: one Attachments tab aggregating a record's files, instead of hunting through its sections. Uploads stay on the forms that already have them. */
export type AttachmentFile = { id: string; fileName: string; sizeBytes?: number };

export function AttachmentsTab({ sections }: { sections: { label: string; files: AttachmentFile[] }[] }) {
  const total = sections.reduce((n, s) => n + s.files.length, 0);
  return (
    <div className="details-stack">
      {total === 0 ? (
        <p className="faint">No attachments on this record yet. Attachments are added on the receiving, billing and collection forms.</p>
      ) : (
        sections
          .filter((s) => s.files.length > 0)
          .map((s) => (
            <div className="card" key={s.label}>
              <div className="card-head">
                <h2>{s.label}</h2>
              </div>
              <ul className="list-plain">
                {s.files.map((f) => (
                  <li key={f.id}>
                    <a href={`/files/attachments/${f.id}`} target="_blank" rel="noreferrer">
                      {f.fileName}
                    </a>
                    {f.sizeBytes != null ? <span className="faint small"> {Math.max(1, Math.round(f.sizeBytes / 1024))} KB</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ))
      )}
    </div>
  );
}
