// Audit (2026-11-05): how the customer accepted the quote. Pure module —
// no server imports — so client components (the acceptance form) can use
// the same options the server view uses. The code is stored on the quote;
// the label is what pages show.
export const ACCEPTANCE_VIA_OPTIONS = [
  { value: "SIGNED_CONFORME", label: "Signed conforme" },
  { value: "EMAIL", label: "Email" },
  { value: "PHONE", label: "Phone call" },
  { value: "IN_PERSON", label: "In person" },
] as const;
export type AcceptanceVia = (typeof ACCEPTANCE_VIA_OPTIONS)[number]["value"];
export const ACCEPTANCE_VIA_LABELS: Record<string, string> = Object.fromEntries(
  ACCEPTANCE_VIA_OPTIONS.map((o) => [o.value, o.label]),
);
