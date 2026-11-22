import { describe, expect, it } from "vitest";
import { DEFAULT_LIST_PAGE_SIZE, pagingWindow } from "@/lib/paging";

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
