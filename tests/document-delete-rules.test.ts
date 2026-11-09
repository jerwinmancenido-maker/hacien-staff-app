import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { auditDeleteLabel, auditRecordLink, auditSentence } from "@/lib/audit-log";
import { activitySummary } from "@/lib/home/activity";
import { plainDeleteRefusal } from "@/lib/services/document-delete";
import { roleFlags, type PermissionUser } from "@/lib/permissions";

const admin: PermissionUser = { ...roleFlags(["ADMIN"]), active: true, canSeeCosts: true };

describe("delete audit and activity wording", () => {
  it("says Deleted and does not link the removed document", () => {
    const after = {
      number: "BL-2026-0004",
      invoiceNo: 42,
      customerName: "Sample Co",
      reason: "Wrong draft",
    };
    expect(auditDeleteLabel(after)).toBe("BL-2026-0004");
    expect(auditRecordLink("Billing", "gone", "delete")).toBeUndefined();
    expect(auditRecordLink("Billing", "still-here")).toBe("/billing/billings/still-here");
    const sentence = auditSentence(
      { entityType: "Billing", entityId: "gone", action: "delete", before: null, after },
      "BL-2026-0004",
      admin,
    );
    expect(sentence.startsWith("Deleted")).toBe(true);
    expect(sentence).toContain("BL-2026-0004");
    expect(sentence).toContain("SI no. 42");
    expect(sentence).toContain("Sample Co");
    expect(sentence).toContain("Wrong draft");
    expect(activitySummary("delete", "Billing", "Ada")).toBe("Ada Deleted a billing");
    expect(activitySummary("delete", "Quote", null)).toContain("Deleted");
  });

  it("turns a foreign-key conflict into a plain refusal", () => {
    const err = new Prisma.PrismaClientKnownRequestError("fk", { code: "P2003", clientVersion: "test" });
    const refusal = plainDeleteRefusal(err);
    expect(refusal?.message).toBe("This document is linked to other records and can't be deleted.");
    expect(plainDeleteRefusal(new Error("other"))).toBeNull();
  });
});
