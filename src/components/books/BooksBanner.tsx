import { BOOKS_DRAFT_BANNER } from "@/lib/books/config";

/** Visible draft-format warning — BIR book layout is unverified. */
export function BooksBanner() {
  return (
    <div className="alert warn" role="status" style={{ marginBottom: 16 }}>
      <b>{BOOKS_DRAFT_BANNER}</b>
    </div>
  );
}
