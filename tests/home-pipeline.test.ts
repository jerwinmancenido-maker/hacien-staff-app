import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildHomePipeline,
  canSeeHomePipelineQuotes,
  canSeeHomePipelineSalesOrders,
  EXCLUDED_OPEN_QUOTE_STATUSES,
  isOpenQuoteStatus,
  isOpenUnbilledSalesOrder,
  OPEN_QUOTE_STATUSES,
  pipelineOpenCaption,
  soUnbilledAmount,
} from "@/lib/home/pipeline";
import { openQuotesHref, openSalesOrdersHref } from "@/lib/home/hrefs";
import { roleFlags, type PermissionUser } from "@/lib/permissions";

function user(
  opts: { roles?: ("ADMIN" | "APPROVER" | "STAFF" | "VIEWER")[]; active?: boolean } = {},
): PermissionUser {
  const roles = opts.roles ?? ["STAFF"];
  return { ...roleFlags(roles), active: opts.active !== false, canSeeCosts: false };
}

describe("home pipeline open-quote filter", () => {
  it("counts DRAFT and SENT as open; excludes WON (converted), LOST (declined), VOID", () => {
    expect(OPEN_QUOTE_STATUSES).toEqual(["DRAFT", "SENT"]);
    expect(EXCLUDED_OPEN_QUOTE_STATUSES).toEqual(["WON", "LOST", "VOID"]);
    expect(isOpenQuoteStatus("DRAFT")).toBe(true);
    expect(isOpenQuoteStatus("SENT")).toBe(true);
    expect(isOpenQuoteStatus("WON")).toBe(false);
    expect(isOpenQuoteStatus("LOST")).toBe(false);
    expect(isOpenQuoteStatus("VOID")).toBe(false);
    // App has no EXPIRED quote status — validUntil is display-only.
    expect(EXCLUDED_OPEN_QUOTE_STATUSES).not.toContain("EXPIRED" as never);
  });

  it("wires the open=1 list filter to DRAFT+SENT in listQuotesView", () => {
    const src = readFileSync(path.join(process.cwd(), "src/lib/quotes/views.ts"), "utf8");
    expect(src).toMatch(/open\?:\s*boolean/);
    expect(src).toMatch(/status:\s*\{\s*in:\s*\["DRAFT",\s*"SENT"\]\s*\}/);
    expect(openQuotesHref()).toBe("/quotes?open=1");
  });
});

describe("home pipeline open-SO filter", () => {
  it("excludes VOID (cancelled) and fully billed OPEN SOs; partial keeps unbilled remainder", () => {
    expect(isOpenUnbilledSalesOrder("VOID", "1000.00", [])).toBe(false);
    expect(isOpenUnbilledSalesOrder("OPEN", "1000.00", ["1000.00"])).toBe(false);
    expect(isOpenUnbilledSalesOrder("OPEN", "1000.00", ["1000.01"])).toBe(false);
    expect(isOpenUnbilledSalesOrder("OPEN", "1000.00", ["400.00"])).toBe(true);
    expect(soUnbilledAmount("1000.00", ["400.00"])).toBe("600.00");
    expect(soUnbilledAmount("1000.00", ["1000.00"])).toBe("0.00");
    expect(soUnbilledAmount("1000.00", ["1200.00"])).toBe("0.00");
  });

  it("wires the open=1 SO list filter to remaining-to-bill > 0", () => {
    const src = readFileSync(path.join(process.cwd(), "src/lib/quotes/views.ts"), "utf8");
    expect(src).toMatch(/openUnbilled/);
    expect(src).toMatch(/remainingToBill/);
    expect(openSalesOrdersHref()).toBe("/sales-orders?open=1");
  });
});

describe("home pipeline role gating + empty state", () => {
  it("hides each row without view rights and hides the card when neither is visible", () => {
    const inactive = user({ active: false });
    expect(canSeeHomePipelineQuotes(inactive)).toBe(false);
    expect(canSeeHomePipelineSalesOrders(inactive)).toBe(false);
    expect(
      buildHomePipeline({
        user: inactive,
        quotesCount: 2,
        quotesTotal: "100.00",
        salesOrdersCount: 1,
        salesOrdersUnbilled: "50.00",
      }),
    ).toBeNull();

    const staff = user({ roles: ["STAFF"] });
    expect(canSeeHomePipelineQuotes(staff)).toBe(true);
    expect(canSeeHomePipelineSalesOrders(staff)).toBe(true);
    const pipe = buildHomePipeline({
      user: staff,
      quotesCount: 0,
      quotesTotal: "0.00",
      salesOrdersCount: 0,
      salesOrdersUnbilled: "0.00",
    });
    expect(pipe).not.toBeNull();
    expect(pipe!.quotes?.caption).toBe("0 open · ₱0");
    expect(pipe!.salesOrders?.caption).toBe("0 open · ₱0 left to bill");
    expect(pipe!.salesOrders?.label).toBe("Open sales orders");
    expect(pipelineOpenCaption(0, 0)).toBe("0 open · ₱0");
  });
});
