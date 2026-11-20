"use client";

// REQ-ATTACH-001: Admin-only "Remove" for one attached file. Removing is an
// archive (the file stays on record), so a plain confirm is enough — no
// reason is collected. On success the page refreshes and the row is gone.
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FormState } from "@/lib/validation/forms";

export function AttachmentArchiveButton({
  fileName,
  action,
}: {
  fileName: string;
  action: () => Promise<FormState>;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="btn btn-secondary btn-sm danger"
        disabled={pending}
        onClick={async () => {
          if (!window.confirm(`Remove "${fileName}"? The file stays on record (archived) and disappears from this document.`)) return;
          setPending(true);
          setError(null);
          const res = await action();
          setPending(false);
          if (res.ok) router.refresh();
          else setError(res.message ?? "Could not remove that file.");
        }}
      >
        {pending ? "Removing…" : "Remove"}
      </button>
      {error && <span className="error small"> {error}</span>}
    </>
  );
}
