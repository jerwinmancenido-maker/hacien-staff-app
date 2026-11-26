// HIGH CARE: Settled policies URL, display host, and version line for HACIEN prints.
// Company Profile slice 2 (census F2): print models and the quote editor
// now read these from Settings identity (pinned per document), which
// Slice 1 seeded verbatim from these constants. The constants remain as
// the fallback for snapshot-less callers (the QR helper's default, the
// print component's no-model fallback, the editor's default props).
export const POLICIES_URL = "https://haciensolutions.com/policies" as const;
export const POLICIES_DISPLAY_HOST = "haciensolutions.com/policies" as const;
/** Footer version line — matches live /terms-of-sale, /warranty, /privacy (+ policies host). */
export const POLICY_VERSION_LINE =
  "Terms of Sale v1.1 · Warranty v1.1 · Privacy v2.3 · haciensolutions.com/policies" as const;
