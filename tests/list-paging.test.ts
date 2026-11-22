import { describe, expect, it } from "vitest";
import { DEFAULT_LIST_PAGE_SIZE, pagingWindow, parsePageParam } from "@/lib/paging";

describe("pagingWindow", () => {
  it("defaults to page 1 with the default page size", () => {
    expect(DEFAULT_LIST_PAGE_SIZE).toBe(100);
    expect(pagingWindow(250)).toEqual({ page: 1, pageSize: 100, totalPages: 3, skip: 0, take: 100 });
  });

  it("slices later pages", () => {
    expect(pagingWindow(250, 2)).toEqual({ page: 2, pageSize: 100, totalPages: 3, skip: 100, take: 100 });
    expect(pagingWindow(250, 3)).toEqual({ page: 3, pageSize: 100, totalPages: 3, skip: 200, take: 100 });
  });

  it("honours an explicit page size", () => {
    expect(pagingWindow(2050, 21, 100)).toEqual({ page: 21, pageSize: 100, totalPages: 21, skip: 2000, take: 100 });
    expect(pagingWindow(10, 1, 4)).toEqual({ page: 1, pageSize: 4, totalPages: 3, skip: 0, take: 4 });
  });

  it("clamps a page past the end to the last page", () => {
    expect(pagingWindow(250, 99).page).toBe(3);
    expect(pagingWindow(250, 99).skip).toBe(200);
  });

  it("treats an invalid page or page size as page 1 / the default size", () => {
    expect(pagingWindow(250, 0).page).toBe(1);
    expect(pagingWindow(250, -3).page).toBe(1);
    expect(pagingWindow(250, Number.NaN).page).toBe(1);
    expect(pagingWindow(250, 1, 0).pageSize).toBe(DEFAULT_LIST_PAGE_SIZE);
    expect(pagingWindow(250, 1, -5).pageSize).toBe(DEFAULT_LIST_PAGE_SIZE);
  });

  it("floors fractional inputs", () => {
    expect(pagingWindow(250, 2.9).page).toBe(2);
    expect(pagingWindow(250, 1, 33.9).pageSize).toBe(33);
  });

  it("an empty list is page 1 of 1", () => {
    expect(pagingWindow(0)).toEqual({ page: 1, pageSize: 100, totalPages: 1, skip: 0, take: 100 });
    expect(pagingWindow(0, 5).page).toBe(1);
  });

  it("page slices tile the whole list with no gaps or overlaps", () => {
    const total = 2050;
    const seen: number[] = [];
    const { totalPages } = pagingWindow(total, 1);
    for (let p = 1; p <= totalPages; p++) {
      const w = pagingWindow(total, p);
      for (let i = w.skip; i < Math.min(w.skip + w.take, total); i++) seen.push(i);
    }
    expect(seen).toEqual(Array.from({ length: total }, (_, i) => i));
  });
});

describe("parsePageParam — the shared pager's jump entry (finding 1043)", () => {
  it("parses a typed page number", () => {
    expect(parsePageParam("3")).toBe(3);
    expect(parsePageParam("27")).toBe(27);
    expect(parsePageParam(" 12 ")).toBe(12);
  });

  it("floors a fractional entry the way the lists always parsed ?page=", () => {
    expect(parsePageParam("3.9")).toBe(3);
  });

  it("reads a missing, blank, non-numeric, or sub-1 entry as page 1", () => {
    expect(parsePageParam(undefined)).toBe(1);
    expect(parsePageParam("")).toBe(1);
    expect(parsePageParam("abc")).toBe(1);
    expect(parsePageParam("0")).toBe(1);
    expect(parsePageParam("-4")).toBe(1);
  });

  it("a jump to the last page lands on the true last page", () => {
    // 2,050 records at the default size = 21 pages, the last holding 50.
    const landed = pagingWindow(2050, parsePageParam("21"));
    expect(landed.page).toBe(21);
    expect(landed.totalPages).toBe(21);
    expect(landed.skip).toBe(2000);
  });

  it("a jump past the end clamps to the last page, never an empty screen", () => {
    expect(pagingWindow(2050, parsePageParam("99")).page).toBe(21);
    expect(pagingWindow(250, parsePageParam("1000")).page).toBe(3);
  });

  it("a jump keeps the filtered total: the clamp follows the filtered page count", () => {
    // Same typed "9" against a filtered-down list of 320 records (4 pages).
    expect(pagingWindow(320, parsePageParam("9")).page).toBe(4);
    expect(pagingWindow(320, parsePageParam("2")).page).toBe(2);
  });
});
