// HIGH CARE: Settled policies URL, display host, and version line for HACIEN prints.
export const POLICIES_URL = "https://haciensolutions.com/policies" as const;
export const POLICIES_DISPLAY_HOST = "haciensolutions.com/policies" as const;
/** Footer version line — matches live /terms-of-sale, /warranty, /privacy (+ policies host). */
export const POLICY_VERSION_LINE =
  "Terms of Sale v1.1 · Warranty v1.1 · Privacy v2.3 · haciensolutions.com/policies" as const;
