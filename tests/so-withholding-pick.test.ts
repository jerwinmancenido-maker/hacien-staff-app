import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pickCodesChanged } from "@/lib/quotes/withholding-defaults";

describe("pickCodesChanged (PR-2b dirty check)", () => {
  it("treats identical picks as unchanged, order aside", () => {
    expect(pickCodesChanged(null, null)).toBe(false);
    expect(pickCodesChanged([], [])).toBe(false);
    expect(pickCodesChanged(["GOV_GOODS_1"], ["GOV_GOODS_1"])).toBe(false);
    expect(pickCodesChanged(["GOV_GOODS_1", "GOV_SERVICES_2"], ["GOV_SERVICES_2", "GOV_GOODS_1"])).toBe(false);
  });

  it("treats null (not set) and [] (explicit none) as different states", () => {
    expect(pickCodesChanged(null, [])).toBe(true);
    expect(pickCodesChanged([], null)).toBe(true);
    expect(pickCodesChanged(null, ["GOODS_1"])).toBe(true);
  });

  it("detects added and removed codes", () => {
    expect(pickCodesChanged(["GOV_GOODS_1"], ["GOV_GOODS_1", "GOV_SERVICES_2"])).toBe(true);
    expect(pickCodesChanged(["GOV_GOODS_1", "GOV_SERVICES_2"], ["GOV_GOODS_1"])).toBe(true);
    expect(pickCodesChanged(["GOODS_1"], ["SERVICES_2"])).toBe(true);
  });
});

describe("SO editor withholding pick wiring (source pins)", () => {
  const editor = readFileSync("src/components/docs/DocumentEditor.tsx", "utf8");
  const page = readFileSync("src/app/(app)/sales-orders/[id]/edit/page.tsx", "utf8");

  it("renders the pick for SO mode via its own handler, not the re-apply path", () => {
    expect(editor).toContain("function changeSoPick");
    expect(editor).toContain("markReapply: false");
    expect(editor).toContain("onChange={changeSoPick}");
  });

  it("sends withholdingCodes only when the pick changed", () => {
    expect(editor).toContain("...(pickChanged ? { withholdingCodes: pick } : {})");
    expect(editor).toContain("pickCodesChanged(initialPick, pick)");
  });

  it("shows the partial-application count (A6), worded for what really happens", () => {
    expect(editor).toContain("Pick applies to {soPickCoverage.applied} of {soPickCoverage.total} lines.");
    expect(editor).toContain("keep their own WH% / ATC.");
    expect(editor).toContain("get no withholding from this pick.");
  });

  it("defaults new and kind-changed lines from the header pick, not the customer's", () => {
    expect(editor).toContain("lineWithholdingSnapshotFromPicks(pickSnapshots ?? [], kind)");
    expect(editor).toContain("blankItem(pickSnapshots ?? [])");
  });

  it("locks the pick on a billed SO with the SI number, fed from the page", () => {
    expect(editor).toContain("whFrozenSiNo");
    expect(editor).toContain("Withholding is locked — this order already has SI no.");
    expect(page).toContain("whFrozenSiNo={firstBilling?.invoiceNo ?? null}");
    expect(page).toContain("editorRates(so.withholding)");
  });
});
