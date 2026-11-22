import { describe, expect, it } from "vitest";
import { BILLING_PAGE_SIZE_DEFAULT, BILLING_PAGE_SIZE_MAX, billingPageWindow } from "@/lib/billing/paging";

describe("billingPageWindow", () => {
  it("defaults to page 1 at 100 per page", () => {
    expect(BILLING_PAGE_SIZE_DEFAULT).toBe(100);
    const win = billingPageWindow(250);
    expect(win.page).toBe(1);
    expect(win.pageSize).toBe(100);
    expect(win.totalPages).toBe(3);
    expect(win.skip).toBe(0);
    expect(win.take).toBe(100);
  });

  it("computes the window for a middle page", () => {
    const win = billingPageWindow(250, 2, 100);
    expect(win.page).toBe(2);
    expect(win.skip).toBe(100);
    expect(win.take).toBe(100);
  });

  it("slices the last partial page with the window", () => {
    const rows = Array.from({ length: 250 }, (_, i) => i + 1);
    const win = billingPageWindow(rows.length, 3, 100);
    const slice = rows.slice(win.skip, win.skip + win.take);
    expect(slice).toHaveLength(50);
    expect(slice[0]).toBe(201);
    expect(slice[49]).toBe(250);
  });

  it("clamps a page above the range to the last page", () => {
    const win = billingPageWindow(250, 99, 100);
    expect(win.page).toBe(3);
    expect(win.skip).toBe(200);
  });

  it("clamps a page below 1 to the first page", () => {
    expect(billingPageWindow(250, 0, 100).page).toBe(1);
    expect(billingPageWindow(250, -5, 100).page).toBe(1);
  });

  it("clamps pageSize into 1..500 and defaults on invalid input", () => {
    expect(BILLING_PAGE_SIZE_MAX).toBe(500);
    expect(billingPageWindow(250, 1, 9999).pageSize).toBe(500);
    expect(billingPageWindow(250, 1, 0).pageSize).toBe(1);
    expect(billingPageWindow(250, 1, Number.NaN).pageSize).toBe(100);
    expect(billingPageWindow(250, 1, undefined).pageSize).toBe(100);
  });

  it("honours a custom pageSize", () => {
    const win = billingPageWindow(1000, 4, 250);
    expect(win.totalPages).toBe(4);
    expect(win.page).toBe(4);
    expect(win.skip).toBe(750);
    expect(win.take).toBe(250);
  });

  it("treats an empty list as exactly one page", () => {
    const win = billingPageWindow(0, 5, 100);
    expect(win.totalPages).toBe(1);
    expect(win.page).toBe(1);
    expect(win.skip).toBe(0);
  });
});
