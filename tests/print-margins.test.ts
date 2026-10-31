// Equal left/right print margins: CSS cascade + Chrome PDF measure (A4 + Letter).
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.resolve("src/app/globals.css"), "utf8");
const hasChrome = spawnSync("which", ["google-chrome"], { encoding: "utf8" }).status === 0;
const hasPdftoppm = spawnSync("which", ["pdftoppm"], { encoding: "utf8" }).status === 0;

function measurePdfSideMarginsMm(opts: {
  paper: "a4" | "letter";
  /** Expected margin band in mm (inclusive). */
  minMm: number;
  maxMm: number;
}): { leftMm: number; rightMm: number; widthPx: number } {
  if (!hasChrome || !hasPdftoppm) {
    throw new Error("Chrome + pdftoppm required for live PDF margin measure");
  }

  const dir = mkdtempSync(path.join(tmpdir(), `pp-margins-${opts.paper}-`));
  const htmlPath = path.join(dir, "doc.html");
  const pdfPath = path.join(dir, "doc.pdf");
  const pngPrefix = path.join(dir, "page");
  const fonts = path.resolve("public/fonts");
  const brand = path.resolve("public/brand/logo-full.svg");
  const cssInline = css.replaceAll('url("/fonts/', `url("${pathToFileURL(fonts).href}/`);
  const shell = opts.paper === "letter" ? "print-shell-letter" : "print-shell-a4";
  const paper = opts.paper === "letter" ? "pp-paper-letter" : "pp-paper-a4";
  // Force the matching @page size so headless Chrome doesn't stay on A4 default.
  const pageSize =
    opts.paper === "letter"
      ? `@page { size: letter; margin: 0.7in; }`
      : `@page { size: A4; margin: 18mm; }`;

  writeFileSync(
    htmlPath,
    `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
${cssInline}
${pageSize}
body{margin:0;background:#fff}
.print-shell{padding:0;background:#fff;min-height:0}
.no-print{display:none!important}
</style></head><body>
<div class="print-shell ${shell}">
<article class="pp-page ${paper}">
<header class="pp-head">
  <div class="pp-letterhead"><div class="pp-letterhead-row">
    <div class="pp-logo-clearspace"><img class="pp-logo" src="${pathToFileURL(brand).href}" alt="HACIEN"/></div>
    <div class="pp-letterhead-text"><div class="pp-company-line">HACIEN Sample Trading Co.</div>
    <div class="pp-pre">Unit 1, Sample St.
Quezon City 1100</div></div>
  </div></div>
  <div class="pp-title-block"><h1><span class="pp-title-pixel"></span>QUOTATION</h1>
  <table class="pp-meta"><tbody><tr><th>Quote no.</th><td>QT-2026-MARG</td></tr></tbody></table></div>
</header>
<section class="pp-party-grid"><div class="pp-party-box"><div class="pp-label">Bill to</div><div class="pp-strong">Sample</div></div>
<div class="pp-party-box"><div class="pp-label">Deliver to</div><div class="pp-pre">Warehouse</div></div></section>
<table class="pp-items"><thead><tr><th>#</th><th>Description</th><th class="num">Qty</th><th class="num">Amount</th></tr></thead>
<tbody><tr><td>1</td><td>Sample line that stretches the table across the printable width</td><td class="num">1</td><td class="num">₱1.00</td></tr></tbody></table>
<div class="pp-closing"><table class="pp-totals"><tbody>
<tr><th>Subtotal</th><td class="num">₱1.00</td></tr>
<tr class="pp-total-emph"><th>Total</th><td class="num">₱1.00</td></tr></tbody></table></div>
<footer class="pp-foot"><div class="pp-foot-left"><span class="pp-thank-you">Thank you for your business</span></div>
<div class="pp-page-num"></div><div class="pp-qr-spacer"></div></footer>
</article></div></body></html>`,
  );

  const profile = path.join(dir, "chrome-profile");
  spawnSync(
    "timeout",
    [
      "45",
      "google-chrome",
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--no-pdf-header-footer",
      `--user-data-dir=${profile}`,
      `--print-to-pdf=${pdfPath}`,
      pathToFileURL(htmlPath).href,
    ],
    { encoding: "utf8" },
  );
  spawnSync("pkill", ["-9", "-f", `user-data-dir=${profile}`]);
  if (!existsSync(pdfPath)) throw new Error(`PDF missing for ${opts.paper}`);

  execFileSync("pdftoppm", ["-png", "-r", "72", "-f", "1", "-l", "1", pdfPath, pngPrefix]);
  const pngPath = `${pngPrefix}-1.png`;
  if (!existsSync(pngPath)) throw new Error(`PNG missing for ${opts.paper}`);

  const out = execFileSync(
    "python3",
    [
      "-c",
      `from PIL import Image
import numpy as np
im=Image.open(${JSON.stringify(pngPath)}).convert("RGB")
a=np.asarray(im)
h,w,_=a.shape
mask=a.max(axis=2)<230
ys,xs=np.where(mask)
left=int(xs.min()); right=int(w-1-xs.max())
print(w, left, right, left*25.4/72, right*25.4/72)`,
    ],
    { encoding: "utf8" },
  ).trim();
  const parts = out.split(/\s+/).map(Number);
  const leftMm = parts[3] ?? NaN;
  const rightMm = parts[4] ?? NaN;
  const widthPx = parts[0] ?? NaN;
  expect(Math.abs(leftMm - rightMm)).toBeLessThanOrEqual(1);
  expect(leftMm).toBeGreaterThanOrEqual(opts.minMm);
  expect(leftMm).toBeLessThanOrEqual(opts.maxMm);
  expect(rightMm).toBeGreaterThanOrEqual(opts.minMm);
  expect(rightMm).toBeLessThanOrEqual(opts.maxMm);
  return { leftMm, rightMm, widthPx };
}

describe("print side margins", () => {
  it("keeps equal on-screen padding and a trailing print override after .pp-page sheet sizing", () => {
    expect(css).toMatch(/\.pp-page\s*\{[^}]*padding:\s*18mm/s);
    expect(css).toMatch(/\.print-shell-letter\s+\.pp-page\s*\{[^}]*padding:\s*0\.7in/s);

    const sheet = css.lastIndexOf(".pp-page {\n  /* HACIEN brand kit print");
    expect(sheet).toBeGreaterThan(0);
    const trailingPrint = css.indexOf(
      "MUST come after .pp-page { width:210mm; padding:18mm } above.",
      sheet,
    );
    expect(trailingPrint).toBeGreaterThan(sheet);
    const override = css.slice(trailingPrint);
    expect(override).toMatch(/\.pp-page[\s\S]*?padding:\s*0\s*!important/);
    expect(override).toMatch(/width:\s*100%\s*!important/);
    // Dead early width/padding reset must stay gone (superseded by trailing override).
    expect(css).not.toMatch(
      /@media print\s*\{[^}]*\.pp-page\s*\{[^}]*width:\s*auto;\s*padding:\s*0;/s,
    );
  });

  it(
    "renders a headless A4 PDF with left/right margins equal within 1mm",
    () => {
      if (!hasChrome || !hasPdftoppm) {
        expect(css).toContain("padding: 0 !important");
        return;
      }
      measurePdfSideMarginsMm({ paper: "a4", minMm: 14, maxMm: 20 });
    },
    120_000,
  );

  it(
    "renders a headless Letter PDF with left/right margins equal within 1mm",
    () => {
      if (!hasChrome || !hasPdftoppm) {
        expect(css).toContain("padding: 0 !important");
        return;
      }
      // @page letter uses 0.7in ≈ 17.78mm
      measurePdfSideMarginsMm({ paper: "letter", minMm: 14, maxMm: 20 });
    },
    120_000,
  );

  it("phone print preview CSS keeps .pp-page at 100% under 640px (no 210mm ≈ 794px h-scroll)", () => {
    // Without this trailing @media, A4 .pp-page { width:210mm } forces ~794 scrollWidth at 390.
    const phone = css.indexOf("Phone / narrow on-screen print preview");
    expect(phone).toBeGreaterThan(0);
    const block = css.slice(phone);
    expect(block).toMatch(/@media\s*\(max-width:\s*640px\)/);
    expect(block).toMatch(/\.pp-page[\s\S]*?width:\s*100%\s*!important/);
    expect(block).toMatch(/\.print-shell[\s\S]*?overflow-x:\s*hidden/);
    expect(block).toMatch(/max-width:\s*100%/);
  });
});
