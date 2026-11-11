/**
 * Scopes used by PR-A. Later modules add their own names.
 * `read` / `write` are the coarse scopes; `customers:read` is one module.
 * `full` grants every scope. It does not bypass the acting user's UI permissions.
 */

/** Every scope an admin may grant on the Settings → API Keys page. */
export const API_SCOPES = [
  { value: "full", label: "Full access (every scope)" },
  { value: "read", label: "Read everything" },
  { value: "write", label: "Write (drafts and master data)" },
  { value: "customers:read", label: "Customers — read" },
  { value: "customers:write", label: "Customers — create and update" },
  { value: "items:read", label: "Items — read" },
] as const;

export const API_SCOPE_VALUES: readonly string[] = API_SCOPES.map((s) => s.value);

/** Keep only grantable scope strings; anything else is dropped, never stored. */
export function sanitizeScopes(values: readonly string[]): string[] {
  return [...new Set(values.filter((v) => API_SCOPE_VALUES.includes(v)))];
}
export function hasScope(scopes: readonly string[], required: string): boolean {
  if (scopes.includes("full")) return true;
  if (scopes.includes(required)) return true;
  if (required.endsWith(":read") && scopes.includes("read")) return true;
  if (required.endsWith(":write") && scopes.includes("write")) return true;
  return false;
}

/** Fail closed: a missing or non-array scopes column grants nothing. */
export function parseScopes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((s): s is string => typeof s === "string" && s.length > 0 && s.length <= 64);
}
