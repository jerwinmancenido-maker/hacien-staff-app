/**
 * Scopes used by PR-A. Later modules add their own names.
 * `read` / `write` are the coarse scopes; `customers:read` is one module.
 * `full` grants every scope. It does not bypass the acting user's UI permissions.
 */
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
