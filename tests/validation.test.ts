import { describe, expect, it } from "vitest";
import { normalizeTin } from "@/lib/validation/tin";
import { contactSchema, customerSchema, missingBankDetails, supplierSchema } from "@/lib/validation/companies";
import { CANT_DEACTIVATE_MAIN, deactivateContactError, makeMainError, makeMainPlan, newContactIsMain } from "@/lib/contacts";
import { auditDiff } from "@/lib/audit";
import { isRateLimited, MAX_FAILED_LOGINS } from "@/lib/auth/rate-limit";
import { formatDate, formatPeso } from "@/lib/format";
import { itemSchema } from "@/lib/validation/quotes";
import {
  WITHHOLDING_PERCENT_NON_NUMERIC_ERROR,
  WITHHOLDING_PERCENT_RANGE_ERROR,
  parseWithholdingPercentInput,
} from "@/lib/quotes/withholding-percent";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const TERMS = ["COD", "Net 30"];
const ROLES = ["Procurement", "Accounting"];

describe("TIN", () => {
  it("normalizes to 000-000-000-000 with head-office branch by default", () => {
    expect(normalizeTin("123456789")).toBe("123-456-789-000");
    expect(normalizeTin("123-456-789")).toBe("123-456-789-000");
    expect(normalizeTin("123-456-789-002")).toBe("123-456-789-002");
    expect(normalizeTin("123-456-789-00002")).toBe("123-456-789-00002");
    expect(normalizeTin("  ")).toBeNull();
    expect(normalizeTin("12-345")).toBe("invalid");
  });
});

describe("customer validation", () => {
  const base = { name: "TESDA", tin: "", address: "", withholdingType: "GOVERNMENT", defaultTerms: "", notes: "" };

  it("requires name and withholding type", () => {
    const r = customerSchema(TERMS).safeParse({ ...base, name: " ", withholdingType: undefined });
    expect(r.success).toBe(false);
    const paths = r.error!.issues.map((i) => i.path[0]);
    expect(paths).toContain("name");
    expect(paths).toContain("withholdingType");
  });

  it("only accepts terms from the list", () => {
    expect(customerSchema(TERMS).safeParse({ ...base, defaultTerms: "Net 90" }).success).toBe(false);
    expect(customerSchema(TERMS).safeParse({ ...base, defaultTerms: "Net 30" }).success).toBe(true);
  });

  it("accepts default withholding codes from the allowed list only", () => {
    const schema = customerSchema(TERMS, ["GOODS_1", "GOV_PT_3"]);
    expect(schema.parse({ ...base, defaultWithholding: ["GOODS_1", "GOV_PT_3", "GOODS_1"] }).defaultWithholding).toEqual(["GOODS_1", "GOV_PT_3"]);
    expect(schema.parse(base).defaultWithholding).toEqual([]);
    expect(schema.safeParse({ ...base, defaultWithholding: ["NOPE"] }).success).toBe(false);
  });

  it("rejects a malformed TIN", () => {
    expect(customerSchema(TERMS).safeParse({ ...base, tin: "abc" }).success).toBe(false);
  });
});

describe("supplier validation", () => {
  it("requires only the name; warns (not blocks) on missing bank details", () => {
    const r = supplierSchema(TERMS).safeParse({
      name: "UNO", tin: "", address: "", taxType: "VAT", defaultTerms: "",
      bankAccountName: "", bankAccountNumber: "", bankBranch: "", bankNotes: "", notes: "",
    });
    expect(r.success).toBe(true);
    expect(missingBankDetails(r.data!)).toBe(true);
    expect(missingBankDetails({ bankAccountName: "UNO Inc.", bankAccountNumber: "123" })).toBe(false);
  });
});

describe("contacts", () => {
  const base = { name: "Ana", role: "Procurement", email: "", phone: "", isMain: false };

  it("needs a name and an email or phone", () => {
    expect(contactSchema(ROLES).safeParse(base).success).toBe(false);
    expect(contactSchema(ROLES).safeParse({ ...base, phone: "0917" }).success).toBe(true);
    expect(contactSchema(ROLES).safeParse({ ...base, name: "", email: "a@example.com" }).success).toBe(false);
  });

  it("first active contact becomes main", () => {
    expect(newContactIsMain([], false)).toBe(true);
    expect(newContactIsMain([{ id: "a", isMain: true, active: true }], false)).toBe(false);
    expect(newContactIsMain([{ id: "a", isMain: true, active: true }], true)).toBe(true);
  });

  it("can't mark the main contact inactive", () => {
    expect(deactivateContactError({ id: "a", isMain: true, active: true })).toBe(CANT_DEACTIVATE_MAIN);
    expect(deactivateContactError({ id: "b", isMain: false, active: true })).toBeNull();
  });

  it("make main leaves exactly one main; the old main stays a normal contact", () => {
    const contacts = [
      { id: "a", isMain: true, active: true },
      { id: "b", isMain: false, active: true },
    ];
    expect(makeMainPlan(contacts, "b")).toEqual({ unset: ["a"], set: "b" });
    expect(makeMainError({ id: "c", isMain: false, active: false })).not.toBeNull();
  });
});

describe("audit diff", () => {
  it("keeps only changed fields and skips secrets", () => {
    expect(
      auditDiff({ name: "A", tin: null, updatedAt: new Date(1), passwordHash: "x" }, { name: "B", tin: null, updatedAt: new Date(2), passwordHash: "y" }),
    ).toEqual({ before: { name: "A" }, after: { name: "B" } });
  });

  it("records a create as after-only", () => {
    expect(auditDiff(null, { name: "A", tin: null })).toEqual({ before: null, after: { name: "A" } });
  });
});

describe("login rate limit", () => {
  const now = new Date("2026-10-30T00:15:00Z");
  const fail = (minAgo: number) => ({ success: false, createdAt: new Date(now.getTime() - minAgo * 60_000) });

  it(`blocks after ${MAX_FAILED_LOGINS} recent failures`, () => {
    expect(isRateLimited(Array.from({ length: MAX_FAILED_LOGINS - 1 }, (_, i) => fail(i)), now)).toBe(false);
    expect(isRateLimited(Array.from({ length: MAX_FAILED_LOGINS }, (_, i) => fail(i)), now)).toBe(true);
  });

  it("ignores old failures and failures before a success", () => {
    expect(isRateLimited(Array.from({ length: 6 }, () => fail(20)), now)).toBe(false);
    const attempts = [...Array.from({ length: 5 }, () => fail(10)), { success: true, createdAt: new Date(now.getTime() - 5 * 60_000) }];
    expect(isRateLimited(attempts, now)).toBe(false);
  });
});

describe("formatting", () => {
  it("formats pesos as ₱1,234.56", () => {
    expect(formatPeso(1234.56)).toBe("₱1,234.56");
    expect(formatPeso(0)).toBe("₱0.00");
    expect(formatPeso(3000000)).toBe("₱3,000,000.00");
    expect(formatPeso(-50)).toBe("-₱50.00");
  });

  it("shows dates in Asia/Manila", () => {
    // 2026-10-30 20:00 UTC is already Oct 31 in Manila (UTC+8).
    expect(formatDate(new Date("2026-10-30T20:00:00Z"))).toBe("Oct 31, 2026");
  });
});

describe("line withholding percent (0–15%)", () => {
  const base = {
    id: null,
    description: "Line",
    kind: "GOODS" as const,
    qty: "1",
    unit: "pc",
    unitPrice: "100",
    supplierUnitCost: "0",
  };

  it("accepts 0% and 15% on the free-text parser and as stored fractions", () => {
    expect(parseWithholdingPercentInput("0")).toEqual({ ok: true, rate: "0.0000" });
    expect(parseWithholdingPercentInput("15")).toEqual({ ok: true, rate: "0.1500" });
    expect(itemSchema.safeParse({ ...base, withholdingRate: "0.0000" }).success).toBe(true);
    expect(itemSchema.safeParse({ ...base, withholdingRate: "0.1500" }).success).toBe(true);
  });

  it("treats a cleared (empty) field as explicit 0% so the server can tell it from legacy NULL", () => {
    expect(parseWithholdingPercentInput("")).toEqual({ ok: true, rate: "0.0000" });
    expect(parseWithholdingPercentInput("   ")).toEqual({ ok: true, rate: "0.0000" });
  });

  it("rejects a negative percent with the plain range error", () => {
    expect(parseWithholdingPercentInput("-1")).toEqual({ ok: false, message: WITHHOLDING_PERCENT_RANGE_ERROR });
    const r = itemSchema.safeParse({ ...base, withholdingRate: "-0.0100" });
    expect(r.success).toBe(false);
    expect(r.success ? null : r.error.issues[0]?.message).toBe(WITHHOLDING_PERCENT_RANGE_ERROR);
  });

  it("rejects above 15% with the plain range error", () => {
    expect(parseWithholdingPercentInput("15.1")).toEqual({ ok: false, message: WITHHOLDING_PERCENT_RANGE_ERROR });
    expect(parseWithholdingPercentInput("100")).toEqual({ ok: false, message: WITHHOLDING_PERCENT_RANGE_ERROR });
    const r = itemSchema.safeParse({ ...base, withholdingRate: "0.1501" });
    expect(r.success).toBe(false);
    expect(r.success ? null : r.error.issues[0]?.message).toBe(WITHHOLDING_PERCENT_RANGE_ERROR);
  });

  it("rejects non-numeric input with a plain non-numeric error", () => {
    expect(parseWithholdingPercentInput("abc")).toEqual({ ok: false, message: WITHHOLDING_PERCENT_NON_NUMERIC_ERROR });
    expect(parseWithholdingPercentInput("1%")).toEqual({ ok: false, message: WITHHOLDING_PERCENT_NON_NUMERIC_ERROR });
    const r = itemSchema.safeParse({ ...base, withholdingRate: "nope" });
    expect(r.success).toBe(false);
    expect(r.success ? null : r.error.issues[0]?.message).toBe(WITHHOLDING_PERCENT_NON_NUMERIC_ERROR);
  });

  it("DocumentEditor disables submit when whPctErrors is non-empty", () => {
    const src = readFileSync(resolve(__dirname, "../src/components/docs/DocumentEditor.tsx"), "utf8");
    expect(src).toMatch(
      /disabled=\{pending \|\| \(mode === "quote" && !h\.customerId\) \|\| Object\.keys\(whPctErrors\)\.length > 0\}/,
    );
  });
});
