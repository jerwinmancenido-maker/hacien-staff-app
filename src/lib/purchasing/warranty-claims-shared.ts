// Phase 3 #8b: supplier warranty claims — PURE, client-safe rules.
//
// Status set approved by Jerwin 2026-11-14:
//   OPEN -> SENT_TO_SUPPLIER -> APPROVED / REJECTED -> REPLACED / CLOSED
// Supplier-side only. This module has NO server imports (no settings,
// no DB) so client components can use the labels, transitions and
// serial helpers without dragging the server settings/db chain into
// the browser bundle. The server-only flag check lives in
// warranty-claims.ts, which re-exports everything here.

export const WARRANTY_CLAIM_STATUSES = [
  "OPEN",
  "SENT_TO_SUPPLIER",
  "APPROVED",
  "REJECTED",
  "REPLACED",
  "CLOSED",
] as const;

export type WarrantyClaimStatus = (typeof WARRANTY_CLAIM_STATUSES)[number];

export const WARRANTY_CLAIM_STATUS_LABELS: Record<WarrantyClaimStatus, string> = {
  OPEN: "Open",
  SENT_TO_SUPPLIER: "Sent to supplier",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  REPLACED: "Replaced",
  CLOSED: "Closed",
};

/** Allowed next statuses from each status. REPLACED and CLOSED are final. */
export const WARRANTY_CLAIM_TRANSITIONS: Record<WarrantyClaimStatus, readonly WarrantyClaimStatus[]> = {
  OPEN: ["SENT_TO_SUPPLIER", "CLOSED"],
  SENT_TO_SUPPLIER: ["APPROVED", "REJECTED", "CLOSED"],
  APPROVED: ["REPLACED", "CLOSED"],
  REJECTED: ["CLOSED"],
  REPLACED: [],
  CLOSED: [],
};

export function canTransitionWarrantyClaim(from: WarrantyClaimStatus, to: WarrantyClaimStatus): boolean {
  return (WARRANTY_CLAIM_TRANSITIONS[from] as readonly string[]).includes(to);
}

/** A claim in one of these statuses still blocks a duplicate (W3). */
export const WARRANTY_CLAIM_ACTIVE_STATUSES: readonly WarrantyClaimStatus[] = ["OPEN", "SENT_TO_SUPPLIER", "APPROVED"];

export function isWarrantyClaimActive(status: WarrantyClaimStatus): boolean {
  return (WARRANTY_CLAIM_ACTIVE_STATUSES as readonly string[]).includes(status);
}

/** Serials are stored comma-separated on the receiving line (S-48). */
export function splitSerialNumbers(serialNumbers: string | null | undefined): string[] {
  if (!serialNumbers) return [];
  return serialNumbers
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Case-insensitive identity for the duplicate guard: blank means line-level. */
export function normalizeClaimSerial(serial: string | null | undefined): string {
  return (serial ?? "").trim().toLowerCase();
}

export function sameClaimSerial(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizeClaimSerial(a) === normalizeClaimSerial(b);
}

/** Sync check from env only (useful in unit tests without DB). */
export function warrantyClaimsEnabledFromEnv(env: Record<string, string | undefined> = process.env): boolean | null {
  const raw = (env.WARRANTY_CLAIMS_ENABLED ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return null;
}
