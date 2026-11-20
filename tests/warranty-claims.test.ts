// Phase 3 #8b: warranty claim pure rules — the approved status set,
// its transitions, the duplicate-guard serial identity, and the flag.

import { describe, expect, it } from "vitest";
import {
  canTransitionWarrantyClaim,
  isWarrantyClaimActive,
  normalizeClaimSerial,
  sameClaimSerial,
  splitSerialNumbers,
  WARRANTY_CLAIM_STATUSES,
  warrantyClaimsEnabledFromEnv,
} from "@/lib/purchasing/warranty-claims";
import { createWarrantyClaimSchema, warrantyClaimStatusSchema } from "@/lib/validation/warranty-claims";
import { DEFAULT_SETTINGS } from "@/lib/settings/defaults";

describe("warranty claim status set (approved by Jerwin 2026-11-14)", () => {
  it("is exactly OPEN -> SENT_TO_SUPPLIER -> APPROVED/REJECTED -> REPLACED/CLOSED", () => {
    expect(WARRANTY_CLAIM_STATUSES).toEqual(["OPEN", "SENT_TO_SUPPLIER", "APPROVED", "REJECTED", "REPLACED", "CLOSED"]);
  });

  it("allows the approved moves", () => {
    expect(canTransitionWarrantyClaim("OPEN", "SENT_TO_SUPPLIER")).toBe(true);
    expect(canTransitionWarrantyClaim("OPEN", "CLOSED")).toBe(true);
    expect(canTransitionWarrantyClaim("SENT_TO_SUPPLIER", "APPROVED")).toBe(true);
    expect(canTransitionWarrantyClaim("SENT_TO_SUPPLIER", "REJECTED")).toBe(true);
    expect(canTransitionWarrantyClaim("APPROVED", "REPLACED")).toBe(true);
    expect(canTransitionWarrantyClaim("APPROVED", "CLOSED")).toBe(true);
    expect(canTransitionWarrantyClaim("REJECTED", "CLOSED")).toBe(true);
  });

  it("refuses skipping, going back, and moves out of final states", () => {
    expect(canTransitionWarrantyClaim("OPEN", "APPROVED")).toBe(false);
    expect(canTransitionWarrantyClaim("OPEN", "REPLACED")).toBe(false);
    expect(canTransitionWarrantyClaim("APPROVED", "OPEN")).toBe(false);
    expect(canTransitionWarrantyClaim("REJECTED", "APPROVED")).toBe(false);
    expect(canTransitionWarrantyClaim("REPLACED", "CLOSED")).toBe(false);
    expect(canTransitionWarrantyClaim("CLOSED", "OPEN")).toBe(false);
  });

  it("active statuses (the W3 duplicate guard set) are OPEN, SENT_TO_SUPPLIER, APPROVED", () => {
    expect(isWarrantyClaimActive("OPEN")).toBe(true);
    expect(isWarrantyClaimActive("SENT_TO_SUPPLIER")).toBe(true);
    expect(isWarrantyClaimActive("APPROVED")).toBe(true);
    expect(isWarrantyClaimActive("REJECTED")).toBe(false);
    expect(isWarrantyClaimActive("REPLACED")).toBe(false);
    expect(isWarrantyClaimActive("CLOSED")).toBe(false);
  });
});

describe("claim serial identity", () => {
  it("splits the receiving line's comma-separated serials", () => {
    expect(splitSerialNumbers("SN-1, SN-2,, SN-3 ")).toEqual(["SN-1", "SN-2", "SN-3"]);
    expect(splitSerialNumbers(null)).toEqual([]);
    expect(splitSerialNumbers("")).toEqual([]);
  });

  it("compares serials case-insensitively, blank = line-level", () => {
    expect(sameClaimSerial("sn-1", " SN-1 ")).toBe(true);
    expect(sameClaimSerial(null, "")).toBe(true);
    expect(sameClaimSerial(null, "SN-1")).toBe(false);
    expect(normalizeClaimSerial(undefined)).toBe("");
  });
});

describe("warranty claims feature flag", () => {
  it("defaults OFF in settings", () => {
    expect(DEFAULT_SETTINGS.features.warrantyClaimsEnabled).toBe(false);
  });

  it("reads the env override like the other feature flags", () => {
    expect(warrantyClaimsEnabledFromEnv({})).toBe(null);
    expect(warrantyClaimsEnabledFromEnv({ WARRANTY_CLAIMS_ENABLED: "true" })).toBe(true);
    expect(warrantyClaimsEnabledFromEnv({ WARRANTY_CLAIMS_ENABLED: "0" })).toBe(false);
    expect(warrantyClaimsEnabledFromEnv({ WARRANTY_CLAIMS_ENABLED: "maybe" })).toBe(null);
  });
});

describe("claim form validation", () => {
  it("requires a fault description and normalises blank optionals to null", () => {
    expect(createWarrantyClaimSchema.safeParse({ fault: "  " }).success).toBe(false);
    const ok = createWarrantyClaimSchema.parse({ fault: "Fan does not spin", serialNumber: "", supplierRef: "" });
    expect(ok).toEqual({ fault: "Fan does not spin", serialNumber: null, supplierRef: null });
  });

  it("accepts only the approved statuses for a status move", () => {
    expect(warrantyClaimStatusSchema.safeParse("SENT_TO_SUPPLIER").success).toBe(true);
    expect(warrantyClaimStatusSchema.safeParse("PENDING").success).toBe(false);
  });
});
