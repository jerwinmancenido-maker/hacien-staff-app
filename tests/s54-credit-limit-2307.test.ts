import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { statementLedgerLines } from "@/lib/print/views";
import { customerSchema } from "@/lib/validation/companies";

const root = process.cwd();
const src = (p: string) => readFileSync(join(root, p), "utf8");

describe("S-54 statement: 2307 on its own line", () => {
  const billing = {
    kind: "billing" as const,
    id: "b1",
    date: "2026-11-01",
    invoiceNo: 1,
    dueDate: "2026-11-30",
    amount: "10000.00",
    runningBalance: "10000.00",
  };
  const collection = {
    kind: "collection" as const,
    id: "c1",
    date: "2026-11-05",
    method: "BANK_TRANSFER" as const,
    receiptNo: "CR-1",
    cash: "9000.00",
    withholding: "1000.00",
    unapplied: "0.00",
    runningBalance: "0.00",
  };

  it("splits a collection with withholding into a cash line and a 2307 line", () => {
    const lines = statementLedgerLines([billing, collection]);
    expect(lines).toHaveLength(3);
    expect(lines[1]!.description).toContain("Collection");
    expect(lines[1]!.description).not.toContain("2307");
    expect(lines[1]!.credits).toBe("9000.00");
    expect(lines[1]!.balance).toBe("1000.00");
    expect(lines[2]!.description).toContain("2307");
    expect(lines[2]!.credits).toBe("1000.00");
    expect(lines[2]!.balance).toBe("0.00");
  });

  it("keeps the closing balance unchanged after the split", () => {
    const lines = statementLedgerLines([billing, collection]);
    expect(lines[lines.length - 1]!.balance).toBe("0.00");
  });

  it("leaves a collection without withholding on one line", () => {
    const lines = statementLedgerLines([{ ...collection, withholding: "0.00", runningBalance: "1000.00" }]);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.credits).toBe("9000.00");
    expect(lines[0]!.balance).toBe("1000.00");
  });

  it("emits only the 2307 line when the whole collection was withheld", () => {
    const lines = statementLedgerLines([{ ...collection, cash: "0.00", withholding: "10000.00", runningBalance: "0.00" }]);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.description).toContain("2307");
    expect(lines[0]!.credits).toBe("10000.00");
  });

  it("folds unapplied credit into the cash line, not the 2307 line", () => {
    const lines = statementLedgerLines([{ ...collection, cash: "8000.00", unapplied: "1000.00", runningBalance: "0.00" }]);
    expect(lines[0]!.credits).toBe("9000.00");
    expect(lines[1]!.credits).toBe("1000.00");
  });
});

describe("S-54 customer credit limit validation", () => {
  const base = {
    name: "Acme",
    tin: "",
    withholdingType: "NONE" as const,
    defaultWithholding: [] as string[],
    defaultTerms: "Net 30",
    notes: "",
  };
  it("blank means no limit", () => {
    const parsed = customerSchema(["Net 30"]).safeParse({ ...base, creditLimit: "" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.creditLimit).toBeNull();
  });
  it("commas are stripped", () => {
    const parsed = customerSchema(["Net 30"]).safeParse({ ...base, creditLimit: "500,000.50" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.creditLimit).toBe("500000.50");
  });
  it("rejects text and negatives", () => {
    expect(customerSchema(["Net 30"]).safeParse({ ...base, creditLimit: "abc" }).success).toBe(false);
    expect(customerSchema(["Net 30"]).safeParse({ ...base, creditLimit: "-100" }).success).toBe(false);
  });
  it("omitted stays valid for older callers", () => {
    expect(customerSchema(["Net 30"]).safeParse(base).success).toBe(true);
  });
});

describe("S-54 credit limit warning surfaces", () => {
  it("customer form has a credit limit field", () => {
    expect(src("src/app/(app)/customers/CustomerForm.tsx")).toContain('name="creditLimit"');
  });
  it("customer overview warns when balance due passes the limit", () => {
    expect(src("src/components/CustomerOverview.tsx")).toContain("Over credit limit");
  });
  it("new quote page warns for an over-limit preselected customer", () => {
    expect(src("src/app/(app)/quotes/new/page.tsx")).toContain("over their credit limit");
  });
});
