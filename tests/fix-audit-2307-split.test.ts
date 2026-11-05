import { describe, expect, it } from "vitest";
import type { Tx } from "@/lib/db";
import {
  splitBillingWithholding,
  withholdingCodesFromSo,
} from "@/lib/services/collections";

/**
 * Audit fix 2026-11-05: 2307 records collapsed the whole withholding onto the
 * first ATC code (WI640 1% carrying ₱12,000 on a ₱300,000 billing = 4%), so
 * the Q4 worksheet inverted it to a ₱1.2M income base per record.
 */

describe("splitBillingWithholding (audit fix)", () => {
  it("splits the E2E case by each code's share of the SO total, not by rate weight", () => {
    const lines = splitBillingWithholding(
      [
        { rate: "0.0100", atcCode: "WI640", amount: "6000.00" },
        { rate: "0.0200", atcCode: "WI157", amount: "0.00" },
        { rate: "0.0300", atcCode: "WB080", amount: "18000.00" },
      ],
      "12000.00",
    );
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({ atcCode: "WI640", rate: "0.0100", amount: "3000.00" });
    expect(lines[1]).toMatchObject({ atcCode: "WI157", rate: "0.0200", amount: "0.00" });
    expect(lines[2]).toMatchObject({ atcCode: "WB080", rate: "0.0300", amount: "9000.00" });
    const sum = lines.reduce((a, l) => a + Number(l.amount), 0);
    expect(sum.toFixed(2)).toBe("12000.00");
  });

  it("keeps cents exact to the remaining total (remainder on the last code)", () => {
    const lines = splitBillingWithholding(
      [
        { rate: "0.0100", atcCode: "WI640", amount: "100.00" },
        { rate: "0.0200", atcCode: "WI157", amount: "100.00" },
        { rate: "0.0300", atcCode: "WB080", amount: "100.00" },
      ],
      "100.01",
    );
    const sum = lines.reduce((a, l) => a + Number(l.amount), 0);
    expect(sum.toFixed(2)).toBe("100.01");
    expect(lines[2]?.amount).toBe("33.35");
  });

  it("returns zero amounts when nothing remains to withhold", () => {
    const lines = splitBillingWithholding(
      [{ rate: "0.0100", atcCode: "WI640", amount: "6000.00" }],
      "0.00",
    );
    expect(lines).toEqual([{ rate: "0.0100", atcCode: "WI640", amount: "0.00" }]);
  });
});

describe("withholdingCodesFromSo (audit fix)", () => {
  function fakeTx(snapshot: unknown, items: unknown[]): Tx {
    return {
      salesOrder: {
        findUnique: async () => ({ withholding: snapshot, items }),
      },
    } as unknown as Tx;
  }

  it("prefers the snapshot codes even when the item lines carry only one code", async () => {
    const tx = fakeTx(
      [
        { code: "GOV_GOODS_1", label: "Government goods 1% (WI640)", lineKind: "GOODS", rate: "0.0100", atcCode: "WI640" },
        { code: "GOV_SERVICES_2", label: "Government services 2% (WI157)", lineKind: "SERVICES", rate: "0.0200", atcCode: "WI157" },
        { code: "GOV_PT_3", label: "Government percentage tax 3% (WB080)", lineKind: "GOV_PT", rate: "0.0300", atcCode: "WB080" },
      ],
      [{ withholdingRate: "0.0100", withholdingAtc: "WI640" }],
    );
    const codes = await withholdingCodesFromSo(tx, "so-1");
    expect(codes.map((c) => c.atcCode)).toEqual(["WI640", "WI157", "WB080"]);
  });

  it("falls back to item-level codes when the SO has no snapshot", async () => {
    const tx = fakeTx([], [{ withholdingRate: "0.0100", withholdingAtc: "WI640" }]);
    const codes = await withholdingCodesFromSo(tx, "so-1");
    expect(codes).toEqual([{ rate: "0.0100", atcCode: "WI640" }]);
  });
});
