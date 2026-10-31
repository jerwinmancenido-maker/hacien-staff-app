#!/usr/bin/env node
/**
 * Chrome print-to-PDF (no browser header/footer) → PNG pages for print-pro-05.
 * Fake sample data only. Requires google-chrome + canvas + pdfjs-dist.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outDir = path.join(root, "docs/screenshots/print-pro-05");
const tmpDir = "/tmp/print-pro-05-artifacts";
mkdirSync(outDir, { recursive: true });
mkdirSync(tmpDir, { recursive: true });

const require = createRequire(import.meta.url);
const { createCanvas } = require("canvas");
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

const fontsDir = pathToFileURL(path.join(root, "public/fonts")).href;
const css = readFileSync(path.join(root, "src/app/globals.css"), "utf8").replaceAll(
  'url("/fonts/',
  `url("${fontsDir}/`,
);
const logoSrc = pathToFileURL(path.join(root, "public/brand/logo-full.svg")).href;

function shellHtml(inner, title, paper = "a4") {
  const shell = paper === "letter" ? "print-shell-letter" : "print-shell-a4";
  const pageSize =
    paper === "letter" ? "@page { size: letter; margin: 0.7in; }" : "@page { size: A4; margin: 18mm; }";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${title}</title>
<style>
${css}
${pageSize}
body { margin: 0; background: #fff; font-family: var(--font); }
.print-shell { padding: 0; background: #fff; min-height: 0; }
.pp-page { box-shadow: none; margin: 0; }
.no-print, .pp-status-row { display: none !important; }
</style>
</head>
<body>
<div class="print-shell ${shell}">${inner}</div>
</body>
</html>`;
}

function peso(n) {
  return `₱${Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function letterhead() {
  return `<div class="pp-letterhead"><div class="pp-letterhead-row">
    <div class="pp-logo-clearspace"><img class="pp-logo" src="${logoSrc}" alt="HACIEN" data-brand-logo="full" /></div>
    <div class="pp-letterhead-text">
      <div class="pp-company-line">HACIEN Sample Trading Co.</div>
      <div class="pp-pre">Unit 1, Sample St.
Quezon City 1100</div>
      <div class="pp-tin-row"><span>TIN 000-000-000-00000</span><span class="pp-nonvat">NON-VAT</span></div>
      <div class="pp-contact-bits">billing@example.com · +63 2 8123 4567</div>
    </div>
  </div></div>`;
}

function party() {
  return `<section class="pp-party-grid" aria-label="Bill to and Deliver to">
    <div class="pp-party-box"><div class="pp-label">Bill to</div><div class="pp-strong">TESDA Regional Office (Sample)</div>
      <div><span class="pp-label-inline">Attn: </span>Ana Cruz</div>
      <div class="pp-pre">Quezon City</div><div>TIN 000-111-222-000</div></div>
    <div class="pp-party-box"><div class="pp-label">Deliver to</div><div class="pp-pre">Pasig City Warehouse</div></div>
  </section>`;
}

function itemsTable(rows) {
  const body = rows
    .map(
      (r, i) =>
        `<tr><td>${i + 1}</td><td><div class="pp-pre">${r.d}</div>${r.detail ? `<div class="pp-item-detail pp-pre">${r.detail}</div>` : ""}</td><td class="num">${r.q}</td><td>${r.u}</td><td class="num">${peso(r.p)}</td><td class="num">${peso(r.a)}</td></tr>`,
    )
    .join("");
  return `<table class="pp-items"><thead><tr><th>#</th><th>Description</th><th class="num">Qty</th><th>Unit</th><th class="num">Unit price</th><th class="num">Amount</th></tr></thead><tbody>${body}</tbody></table>`;
}

function docArticle({ kind, title, number, date, metaRows, rows, totals, words, notes, tax, paper = "a4" }) {
  const meta = metaRows.map((m) => `<tr><th>${m[0]}</th><td>${m[1]}</td></tr>`).join("");
  const tot = totals
    .map((t) => `<tr class="${t[2] ? "pp-total-emph" : ""}"><th>${t[0]}</th><td class="num">${peso(t[1])}</td></tr>`)
    .join("");
  const paperClass = paper === "letter" ? "pp-paper-letter" : "pp-paper-a4";
  return `<article class="pp-page ${paperClass}" aria-label="${title} ${number}" data-print-kind="${kind}">
  <header class="pp-head">${letterhead()}
    <div class="pp-title-block"><h1><span class="pp-title-pixel" aria-hidden="true"></span>${title}</h1>
      <table class="pp-meta"><tbody>
        <tr><th>${kind === "quote" ? "Quote no." : kind === "sales_order" ? "SO no." : "Billing no."}</th><td>${number}</td></tr>
        <tr><th>Date</th><td>${date}</td></tr>
        ${meta}
      </tbody></table>
    </div>
  </header>
  ${party()}
  ${itemsTable(rows)}
  <div class="pp-closing">
    <table class="pp-totals"><tbody>${tot}</tbody></table>
    <p class="pp-words"><span class="pp-label-inline">Amount in words: </span>${words}</p>
    <section class="pp-notes"><div><span class="pp-label-inline">Terms &amp; conditions: </span>Net 30</div>
      ${notes || ""}</section>
    <section class="pp-pay" aria-label="Payment instructions"><div class="pp-label">Bank / e-wallet details</div>
      <ul><li>Bank: Sample Bank · HACIEN Sample · ****1234</li></ul></section>
    <section class="pp-signatories" aria-label="Signatures">
      <div class="pp-signatory"><div class="pp-sign-line" aria-hidden="true"></div><div class="pp-sign-role">Prepared by</div><div class="pp-sign-name">Jerwin</div><div class="pp-sign-position">&nbsp;</div></div>
      <div class="pp-signatory"><div class="pp-sign-line" aria-hidden="true"></div><div class="pp-sign-role">Conforme</div><div class="pp-sign-name-hint">Printed name</div><div class="pp-sign-date">Date</div></div>
    </section>
  </div>
  <footer class="pp-foot">
    <div class="pp-foot-left"><span class="pp-thank-you">Thank you for your business</span>
      ${tax.map((t) => `<div class="pp-tax-line">${t}</div>`).join("")}</div>
    <div class="pp-page-num" aria-hidden="true"></div>
    <div class="pp-qr-spacer" aria-hidden="true"></div>
  </footer>
</article>`;
}

const threeLines = [
  { d: "Laptop i5 (sample)", q: "10", u: "pc", p: 52000, a: 520000 },
  { d: "Wireless mouse (sample)", q: "10", u: "pc", p: 800, a: 8000 },
  { d: "HDMI cable 2m (sample)", detail: "Optional detail line", q: "10", u: "pc", p: 350, a: 3500 },
];

const twentyFive = Array.from({ length: 25 }, (_, i) => ({
  d: `Sample line item ${i + 1}`,
  detail: i % 5 === 0 ? "Optional detail line" : null,
  q: "1",
  u: "pc",
  p: 1000,
  a: 1000,
}));

const docs = [
  {
    file: "quote-3-lines",
    title: "QT-2026-0001",
    html: docArticle({
      kind: "quote",
      title: "QUOTATION",
      number: "QT-2026-0001",
      date: "Oct 30, 2026",
      metaRows: [
        ["Valid until", "Nov 30, 2026"],
        ["Prepared by", "Jerwin"],
      ],
      rows: threeLines,
      totals: [
        ["Subtotal", 531500],
        ["Total", 531500, true],
      ],
      words: "Five hundred thirty-one thousand five hundred pesos only",
      tax: ["This is a quotation, not an invoice."],
    }),
  },
  {
    file: "quote-25-lines",
    title: "QT-2026-0025",
    html: docArticle({
      kind: "quote",
      title: "QUOTATION",
      number: "QT-2026-0025",
      date: "Oct 30, 2026",
      metaRows: [
        ["Valid until", "Nov 30, 2026"],
        ["Prepared by", "Jerwin"],
      ],
      rows: twentyFive,
      totals: [
        ["Subtotal", 25000],
        ["Total", 25000, true],
      ],
      words: "Twenty-five thousand pesos only",
      tax: ["This is a quotation, not an invoice."],
    }),
  },
  {
    file: "sales-order",
    title: "SO-2026-0002",
    html: docArticle({
      kind: "sales_order",
      title: "SALES ORDER",
      number: "SO-2026-0002",
      date: "Oct 30, 2026",
      metaRows: [
        ["Prepared by", "Jerwin"],
        ["Customer PO/ref", "PO-CUST-99"],
      ],
      rows: threeLines,
      totals: [
        ["Subtotal", 531500],
        ["Total", 531500, true],
      ],
      words: "Five hundred thirty-one thousand five hundred pesos only",
      tax: ["This is a quotation, not an invoice."],
    }),
  },
  {
    file: "billing-statement",
    title: "BL-2026-0001",
    html: docArticle({
      kind: "billing",
      title: "BILLING STATEMENT",
      number: "BL-2026-0001",
      date: "Oct 30, 2026",
      metaRows: [
        ["Booklet invoice no.", "12"],
        ["Due date", "Nov 30, 2026"],
        ["Sales order", "SO-2026-0002"],
        ["Prepared by", "Jerwin"],
      ],
      rows: [{ d: "Billing for sales order SO-2026-0002 (booklet #12)", q: "1", u: "lot", p: 531500, a: 531500 }],
      totals: [
        ["Subtotal", 531500],
        ["Total / Net expected", 531500, true],
      ],
      words: "Five hundred thirty-one thousand five hundred pesos only",
      tax: ["This is not an official invoice/receipt", "This document is not valid for claim of input tax"],
    }),
  },
  {
    file: "quote-withholding",
    title: "QT-2026-WHT1",
    html: docArticle({
      kind: "quote",
      title: "QUOTATION",
      number: "QT-2026-WHT1",
      date: "Oct 30, 2026",
      metaRows: [
        ["Valid until", "Nov 30, 2026"],
        ["Prepared by", "Jerwin"],
      ],
      rows: threeLines.slice(0, 1),
      totals: [
        ["Subtotal", 520000],
        ["Total", 520000, true],
        ["Less: withholding tax (est.) 1% + 3%", 20800],
        ["Net amount due", 499200, true],
      ],
      words: "Five hundred twenty thousand pesos only",
      tax: ["This is a quotation, not an invoice."],
    }),
  },
  {
    file: "quote-3-lines-letter",
    title: "QT-2026-LTR1",
    paper: "letter",
    html: docArticle({
      kind: "quote",
      title: "QUOTATION",
      number: "QT-2026-LTR1",
      date: "Oct 30, 2026",
      paper: "letter",
      metaRows: [
        ["Valid until", "Nov 30, 2026"],
        ["Prepared by", "Jerwin"],
      ],
      rows: threeLines,
      totals: [
        ["Subtotal", 531500],
        ["Total", 531500, true],
      ],
      words: "Five hundred thirty-one thousand five hundred pesos only",
      tax: ["This is a quotation, not an invoice."],
    }),
  },
  {
    file: "letterhead-clearspace",
    title: "letterhead-clearspace",
    html: `<article class="pp-page pp-paper-a4" aria-label="Letterhead clear space" data-print-kind="quote">
      <header class="pp-head">${letterhead()}
        <div class="pp-title-block"><h1><span class="pp-title-pixel" aria-hidden="true"></span>QUOTATION</h1>
          <table class="pp-meta"><tbody>
            <tr><th>Quote no.</th><td>QT-2026-CLEAR</td></tr>
            <tr><th>Date</th><td>Oct 30, 2026</td></tr>
          </tbody></table>
        </div>
      </header>
      <p style="font-size:9pt;color:#525252;margin-top:14px;max-width:140mm">
        Letterhead logo: brand kit <code>logo-full.svg</code> at 45&nbsp;mm wide (SVG only — never retyped).
        Clear space padding is 2.2&nbsp;mm on every side (2× the blue square ≈ 0.286 × cap height).
        The dashed outline below is screen/artifact annotation only.
      </p>
      <div style="margin-top:10px;display:inline-block;border:1px dashed #2563EB;padding:2.2mm;">
        <img class="pp-logo" src="${logoSrc}" alt="HACIEN" style="width:45mm;height:auto;display:block" />
      </div>
      <div style="font-size:8pt;color:#525252;margin-top:6px">Dashed box = clear space boundary (artifact annotation)</div>
      <footer class="pp-foot"><div class="pp-foot-left"></div><div class="pp-page-num" aria-hidden="true"></div><div class="pp-qr-spacer"></div></footer>
    </article>`,
  },
];

function chromePdf(htmlPath, pdfPath, title) {
  const profile = path.join(tmpDir, `profile-${path.basename(pdfPath, ".pdf")}`);
  mkdirSync(profile, { recursive: true });
  // Chrome sometimes writes the PDF then hangs on exit; treat a non-empty PDF as success.
  spawnSync(
    "timeout",
    [
      "60",
      "google-chrome",
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--no-pdf-header-footer",
      "--virtual-time-budget=15000",
      `--user-data-dir=${profile}`,
      `--print-to-pdf=${pdfPath}`,
      pathToFileURL(htmlPath).href,
    ],
    { encoding: "utf8" },
  );
  spawnSync("pkill", ["-9", "-f", `user-data-dir=${profile}`], { encoding: "utf8" });
  if (!existsSync(pdfPath) || readFileSync(pdfPath).byteLength < 1000) {
    throw new Error(`Chrome PDF failed for ${title} (missing or tiny output)`);
  }
}

async function pdfToPngs(pdfPath, baseName) {
  // Prefer pdftoppm so PNGs match real print-to-PDF layout (equal side margins).
  const ppm = spawnSync("which", ["pdftoppm"], { encoding: "utf8" });
  if (ppm.status === 0) {
    const prefix = path.join(tmpDir, `ppm-${baseName}`);
    const r = spawnSync("pdftoppm", ["-png", "-r", "150", pdfPath, prefix], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`pdftoppm failed for ${baseName}: ${r.stderr}`);
    const pages = [];
    for (let i = 1; ; i++) {
      const src = `${prefix}-${i}.png`;
      if (!existsSync(src)) break;
      pages.push(src);
    }
    if (pages.length === 0) throw new Error(`pdftoppm produced no pages for ${baseName}`);
    const paths = [];
    if (pages.length === 1) {
      const out = path.join(outDir, `${baseName}.png`);
      copyFileSync(pages[0], out);
      paths.push(out);
    } else {
      pages.forEach((src, idx) => {
        const out = path.join(outDir, `${baseName}-p${idx + 1}.png`);
        copyFileSync(src, out);
        paths.push(out);
      });
      copyFileSync(pages[0], path.join(outDir, `${baseName}.png`));
    }
    return paths;
  }

  const data = new Uint8Array(readFileSync(pdfPath));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  const paths = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport }).promise;
    const suffix = doc.numPages > 1 ? `-p${i}` : "";
    const out = path.join(outDir, `${baseName}${suffix}.png`);
    writeFileSync(out, canvas.toBuffer("image/png"));
    paths.push(out);
  }
  return paths;
}

const written = [];
for (const d of docs) {
  const htmlPath = path.join(tmpDir, `${d.file}.html`);
  const pdfPath = path.join(tmpDir, `${d.file}.pdf`);
  writeFileSync(htmlPath, shellHtml(d.html, d.title, d.paper ?? "a4"));
  chromePdf(htmlPath, pdfPath, d.title);
  copyFileSync(pdfPath, path.join(outDir, `${d.file}.pdf`));
  const pngs = await pdfToPngs(pdfPath, d.file);
  written.push({ file: d.file, pdf: `${d.file}.pdf`, pngs: pngs.map((p) => path.basename(p)) });
  console.log("OK", d.file, pngs.map((p) => path.basename(p)).join(", "));
}

writeFileSync(
  path.join(outDir, "README.md"),
  `# Print-pro-05 artifacts

Fake sample data only (TESDA / Sample Bank / TIN 000-000-000-00000).
Chrome headless \`--print-to-pdf --no-pdf-header-footer\` (real print layout), then \`pdftoppm\` → PNG.

| Artifact | Notes |
|---|---|
| quote-3-lines / quote-3-lines-after | Quotation, 3 lines A4 (after = latest layout) |
| quote-3-lines-letter | Quotation, 3 lines Letter (0.7in \`@page\`) |
| quote-3-lines-before | Earlier uneven-margin reference |
| quote-25-lines (+ p1/p2) | Quotation, 25 lines |
| sales-order | SO-2026-0002 |
| billing-statement | Billing statement (BIR wording unchanged) |
| quote-withholding | Est. WHT lines |
| letterhead-clearspace | Brand kit logo-full.svg at 45 mm with clear-space annotation |

Equal side margins: A4 \`@page\` 18mm, Letter \`@page\` 0.7in; content fills the printable width (|L−R| ≤ 1mm).
`,
);

console.log(JSON.stringify(written, null, 2));
