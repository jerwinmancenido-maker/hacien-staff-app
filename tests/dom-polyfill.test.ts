// DOMMatrix stand-in (src/lib/2303/dom-polyfill.ts): the matrix math must
// be right, because pdf.js uses it for text positions. No canvas needed.
import { describe, expect, it } from "vitest";
import { DomMatrixPolyfill } from "@/lib/2303/dom-polyfill";

describe("DomMatrixPolyfill", () => {
  it("starts as identity", () => {
    const m = new DomMatrixPolyfill();
    expect([m.a, m.b, m.c, m.d, m.e, m.f]).toEqual([1, 0, 0, 1, 0, 0]);
    expect(m.isIdentity).toBe(true);
  });

  it("builds from a 6-number array", () => {
    const m = new DomMatrixPolyfill([1, 2, 3, 4, 5, 6]);
    expect([m.a, m.b, m.c, m.d, m.e, m.f]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("translates a point", () => {
    const m = new DomMatrixPolyfill().translate(10, 20);
    expect(m.transformPoint({ x: 1, y: 2 })).toEqual({ x: 11, y: 22, z: 0, w: 1 });
  });

  it("scales a point", () => {
    const m = new DomMatrixPolyfill().scale(2, 3);
    expect(m.transformPoint({ x: 4, y: 5 })).toEqual({ x: 8, y: 15, z: 0, w: 1 });
  });

  it("multiplies in order (other applies first)", () => {
    // translate(10, 0) then scale(2, 1): point (1, 1) -> (2, 1) -> (12, 1).
    const m = new DomMatrixPolyfill().translate(10, 0).multiply(new DomMatrixPolyfill().scale(2, 1));
    expect(m.transformPoint({ x: 1, y: 1 }).x).toBe(12);
  });

  it("inverts and round-trips", () => {
    const m = new DomMatrixPolyfill([2, 0, 0, 3, 10, 20]);
    const back = m.inverse().transformPoint(m.transformPoint({ x: 5, y: 7 }));
    expect(back.x).toBeCloseTo(5);
    expect(back.y).toBeCloseTo(7);
  });

  it("marks a singular matrix non-invertible", () => {
    const m = new DomMatrixPolyfill([0, 0, 0, 0, 0, 0]).invertSelf();
    expect(Number.isNaN(m.a)).toBe(true);
    expect(m.is2D).toBe(false);
  });
});
