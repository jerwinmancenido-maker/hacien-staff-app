// Browser globals pdf.js needs at module load, for a server without them.
//
// pdf-parse bundles pdfjs-dist, whose canvas module constructs a
// `DOMMatrix` at the top level (`const Wi = new DOMMatrix, ...`). Node has
// no DOMMatrix, and pdf.js only supplies one when it can load the native
// `@napi-rs/canvas` package. On Hostinger that native package does not
// load, so importing pdf-parse threw `ReferenceError: DOMMatrix is not
// defined` and the whole parse route answered 500 — for PDFs and photos
// alike, since the import happens before any extraction runs.
//
// This module installs small pure-JS stand-ins for DOMMatrix, ImageData
// and Path2D when they are missing, so the import succeeds and text
// extraction (which never renders) works without the native package.
// It must be imported BEFORE pdf-parse — extract.ts imports it first.
// The stand-ins are only installed when the real globals are absent, so
// a host that does have them (local dev, CI) keeps using the real ones.
//
// DOMMatrix here is a correct 2D affine matrix: [a b c d e f], point
// transform x' = a*x + c*y + e, y' = b*x + d*y + f, multiply as
// (this * other), translate/scale post-multiply, invert per the spec.

/* eslint-disable @typescript-eslint/no-unused-vars */
// (Path2D is a render-only no-op stub: its parameters exist to match the
// API shape and are intentionally unused.)

type MatrixInit = number[] | string | DomMatrixPolyfill | { a: number; b: number; c: number; d: number; e: number; f: number };

export class DomMatrixPolyfill {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  is2D = true;
  isIdentity = true;

  constructor(init?: MatrixInit) {
    if (init === undefined) {
      this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0;
    } else if (Array.isArray(init)) {
      const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = init;
      this.a = a; this.b = b; this.c = c; this.d = d; this.e = e; this.f = f;
    } else if (typeof init === "string") {
      const nums = init.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) ?? [];
      const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = nums.length >= 6 ? nums.slice(0, 6) : [];
      this.a = a; this.b = b; this.c = c; this.d = d; this.e = e; this.f = f;
    } else {
      this.a = init.a; this.b = init.b; this.c = init.c; this.d = init.d; this.e = init.e; this.f = init.f;
    }
    this.syncFlags();
  }

  private syncFlags() {
    this.isIdentity = this.a === 1 && this.b === 0 && this.c === 0 && this.d === 1 && this.e === 0 && this.f === 0;
  }

  private set(a: number, b: number, c: number, d: number, e: number, f: number) {
    this.a = a; this.b = b; this.c = c; this.d = d; this.e = e; this.f = f;
    this.syncFlags();
    return this;
  }

  /** this * other (other applies first). */
  multiply(other: DomMatrixPolyfill) {
    const { a, b, c, d, e, f } = this;
    return new DomMatrixPolyfill([
      a * other.a + c * other.b,
      b * other.a + d * other.b,
      a * other.c + c * other.d,
      b * other.c + d * other.d,
      a * other.e + c * other.f + e,
      b * other.e + d * other.f + f,
    ]);
  }

  multiplySelf(other: DomMatrixPolyfill) {
    const m = this.multiply(other);
    return this.set(m.a, m.b, m.c, m.d, m.e, m.f);
  }

  /** other * this (other applies last). */
  preMultiplySelf(other: DomMatrixPolyfill) {
    const m = other.multiply(this);
    return this.set(m.a, m.b, m.c, m.d, m.e, m.f);
  }

  translate(tx = 0, ty = 0) {
    return this.set(this.a, this.b, this.c, this.d, this.a * tx + this.c * ty + this.e, this.b * tx + this.d * ty + this.f);
  }

  scale(sx = 1, sy: number = sx) {
    return this.set(this.a * sx, this.b * sx, this.c * sy, this.d * sy, this.e, this.f);
  }

  rotate(angleDeg = 0) {
    const rad = (angleDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return this.multiplySelf(new DomMatrixPolyfill([cos, sin, -sin, cos, 0, 0]));
  }

  invertSelf() {
    const det = this.a * this.d - this.b * this.c;
    if (det === 0) {
      this.is2D = false;
      return this.set(NaN, NaN, NaN, NaN, NaN, NaN);
    }
    const { a, b, c, d, e, f } = this;
    return this.set(d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det);
  }

  inverse() {
    return new DomMatrixPolyfill(this).invertSelf();
  }

  transformPoint(point: { x: number; y: number }) {
    return { x: this.a * point.x + this.c * point.y + this.e, y: this.b * point.x + this.d * point.y + this.f, z: 0, w: 1 };
  }

  toFloat32Array() {
    return new Float32Array([this.a, this.b, 0, 0, this.c, this.d, 0, 0, 0, 0, 1, 0, this.e, this.f, 0, 1]);
  }

  toString() {
    return `matrix(${this.a}, ${this.b}, ${this.c}, ${this.d}, ${this.e}, ${this.f})`;
  }
}

export class ImageDataPolyfill {
  width: number;
  height: number;
  data: Uint8ClampedArray;

  constructor(width: number, height?: number, data?: Uint8ClampedArray);
  constructor(data: Uint8ClampedArray, width: number, height?: number);
  constructor(a: number | Uint8ClampedArray, b?: number, c?: number | Uint8ClampedArray) {
    if (a instanceof Uint8ClampedArray) {
      this.data = a;
      this.width = b ?? 0;
      this.height = c as number;
    } else {
      this.width = a;
      this.height = b ?? 0;
      this.data = c instanceof Uint8ClampedArray ? c : new Uint8ClampedArray(this.width * this.height * 4);
    }
  }
}

export class Path2DPolyfill {
  constructor(_path?: string | Path2DPolyfill) {}
  addPath(_path: Path2DPolyfill, _transform?: DomMatrixPolyfill) {}
  moveTo(_x: number, _y: number) {}
  lineTo(_x: number, _y: number) {}
  bezierCurveTo(_cp1x: number, _cp1y: number, _cp2x: number, _cp2y: number, _x: number, _y: number) {}
  quadraticCurveTo(_cpx: number, _cpy: number, _x: number, _y: number) {}
  arc(_x: number, _y: number, _radius: number, _start: number, _end: number, _ccw?: boolean) {}
  arcTo(_x1: number, _y1: number, _x2: number, _y2: number, _radius: number) {}
  ellipse(_x: number, _y: number, _rx: number, _ry: number, _rot: number, _start: number, _end: number, _ccw?: boolean) {}
  rect(_x: number, _y: number, _w: number, _h: number) {}
  closePath() {}
}

export function installDomPolyfills() {
  const g = globalThis as unknown as Record<string, unknown>;
  if (typeof g.DOMMatrix === "undefined") g.DOMMatrix = DomMatrixPolyfill;
  if (typeof g.ImageData === "undefined") g.ImageData = ImageDataPolyfill;
  if (typeof g.Path2D === "undefined") g.Path2D = Path2DPolyfill;
}

// Install on import: extract.ts imports this module before pdf-parse,
// so the globals exist by the time pdf.js evaluates.
installDomPolyfills();
