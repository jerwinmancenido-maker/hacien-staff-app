// Phase 2 #6: the shared credit-limit warning banner. Presentational only —
// the text (and the exposure figure inside it) comes from the ONE helper in
// src/lib/billing/customer-exposure.ts, so every surface quotes the same
// number in the same words. Warning only; it never blocks a save.
export function CreditLimitWarning({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div className="alert warn" role="status">
      {text}
    </div>
  );
}
