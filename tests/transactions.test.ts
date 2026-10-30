// Transactions tab helpers: exact money sums, margin %, and customer filter kinds.

import { describe, expect, it } from "vitest";
import { parseTransactionFilters } from "@/components/TransactionsTab";
import {
  BILLING_KINDS,
  CUSTOMER_TX_KINDS,
  PURCHASING_KINDS,
  SUPPLIER_TX_KINDS,
  TRANSACTION_KINDS,
  __test,
} from "@/lib/services/transactions";

const { sumMoney, pctOf } = __test;

describe("transaction totals", () => {
  it("adds money exactly (no float drift)", () => {
    expect(sumMoney(["0.10", "0.20"])).toBe("0.30");
    expect(sumMoney(["520000.00", "20000.00", "0.01"])).toBe("540000.01");
    expect(sumMoney([])).toBe("0.00");
    expect(sumMoney([null, undefined, "5"])).toBe("5.00");
    expect(sumMoney([{ toFixed: () => "12.34" }, "0.66"])).toBe("13.00");
    expect(sumMoney(["-10.00", "2.50"])).toBe("-7.50");
  });

  it("margin % of the total, 2 decimals, half away from zero", () => {
    expect(pctOf("70000.00", "540000.00")).toBe("12.96");
    expect(pctOf("1.00", "3.00")).toBe("33.33");
    expect(pctOf("2.00", "3.00")).toBe("66.67");
    expect(pctOf("-1.00", "8.00")).toBe("-12.50");
    expect(pctOf("5.00", "0.00")).toBe("0.00");
  });
});

describe("transaction kind separation", () => {
  it("splits customer vs supplier kinds both ways", () => {
    expect(CUSTOMER_TX_KINDS).toEqual(["QUOTE", "SALES_ORDER", "BILLING", "COLLECTION"]);
    expect(SUPPLIER_TX_KINDS).toEqual(["PURCHASE_ORDER", "RECEIVING_REPORT", "SUPPLIER_BILL"]);
    expect(PURCHASING_KINDS).toEqual(SUPPLIER_TX_KINDS);
    expect(BILLING_KINDS).toEqual(["BILLING", "COLLECTION"]);
    expect(CUSTOMER_TX_KINDS.some((k) => SUPPLIER_TX_KINDS.includes(k))).toBe(false);
    expect(TRANSACTION_KINDS).toEqual([...CUSTOMER_TX_KINDS.slice(0, 2), ...SUPPLIER_TX_KINDS, ...BILLING_KINDS]);
  });

  it("parses type filters including purchasing kinds (supplier tab)", () => {
    expect(parseTransactionFilters({ type: "PURCHASE_ORDER" }, []).type).toBe("PURCHASE_ORDER");
    expect(parseTransactionFilters({ type: "BILLING" }, []).type).toBe("BILLING");
    expect(parseTransactionFilters({ type: "NOPE" }, []).type).toBeNull();
  });
});
