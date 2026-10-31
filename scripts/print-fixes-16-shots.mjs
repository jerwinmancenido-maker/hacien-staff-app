#!/usr/bin/env node
/**
 * Print-preview shots at 1280 for build brief 16 (fake sample data only).
 * Renders ProfessionalPrintDocument fixtures via vitest, then Chrome screenshots.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outDocs = path.join(root, "docs/screenshots/print-fixes-16");
const outArt = "/opt/cursor/artifacts";
const tmpDir = "/tmp/print-fixes-16-shots";
mkdirSync(outDocs, { recursive: true });
mkdirSync(outArt, { recursive: true });
mkdirSync(tmpDir, { recursive: true });

const dumpTest = path.join(root, "tests/_tmp_print_fixes_16_dump.test.ts");
writeFileSync(
  dumpTest,
  `
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { writeFileSync } from "node:fs";
import { afterAll, describe, it } from "vitest";
import { ProfessionalPrintDocument } from "@/components/docs/ProfessionalPrintDocument";
import { billingPrintFixture, quotePrintFixture, salesOrderPrintFixture } from "./fixtures/print-doc";

function html(doc: Parameters<typeof ProfessionalPrintDocument>[0]["doc"]) {
  return renderToStaticMarkup(createElement(ProfessionalPrintDocument, { doc }));
}

describe("dump print html for shots", () => {
  it("writes fixture markup", () => {
    const empty = {
      ...quotePrintFixture(),
      company: { ...quotePrintFixture().company, address: "", tin: "" },
    };
    writeFileSync(${JSON.stringify(path.join(tmpDir, "parts.json"))}, JSON.stringify({
      filledQuote: html(quotePrintFixture()),
      filledSo: html(salesOrderPrintFixture()),
      filledBilling: html(billingPrintFixture()),
      emptyAddr: html(empty),
    }));
  });
});
`,
);

const dump = spawnSync("npx", ["vitest", "run", "tests/_tmp_print_fixes_16_dump.test.ts", "--reporter=dot"], {
  cwd: root,
  encoding: "utf8",
  env: {
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL || "mysql://hacien:hacien_local_only@127.0.0.1:3306/hacien_dev",
    TEST_DATABASE_URL: process.env.TEST_DATABASE_URL || "",
    SESSION_SECRET: process.env.SESSION_SECRET || "local-dev-session-secret-not-for-prod",
  },
});
try {
  if (existsSync(dumpTest)) unlinkSync(dumpTest);
} catch {
  /* ignore */
}
if (dump.status !== 0) {
  console.error(dump.stdout, dump.stderr);
  process.exit(1);
}

const parts = JSON.parse(readFileSync(path.join(tmpDir, "parts.json"), "utf8"));
const fontsDir = pathToFileURL(path.join(root, "public/fonts")).href;
const css = readFileSync(path.join(root, "src/app/globals.css"), "utf8").replaceAll(
  'url("/fonts/',
  `url("${fontsDir}/`,
);
const logoAbs = pathToFileURL(path.join(root, "public/brand/logo-full.svg")).href;

function shellHtml(inner, title) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${title}</title>
<style>
${css}
@page { size: A4; margin: 18mm; }
body { margin: 0; background: #e8e8e8; font-family: var(--font); }
.print-shell { padding: 24px; background: #e8e8e8; min-height: 100vh; box-sizing: border-box; }
.pp-page { box-shadow: 0 1px 8px rgba(0,0,0,.12); margin: 0 auto; background: #fff; }
</style>
</head>
<body>
<div class="print-shell print-shell-a4">${inner}</div>
</body>
</html>`;
}

function shot(htmlPath, pngPath) {
  const profile = path.join(tmpDir, `chrome-profile-${path.basename(pngPath)}`);
  mkdirSync(profile, { recursive: true });
  const r = spawnSync(
    "timeout",
    [
      "60",
      "google-chrome",
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--hide-scrollbars",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      `--screenshot=${pngPath}`,
      "--window-size=1280,1800",
      "--force-device-scale-factor=1",
      "--virtual-time-budget=8000",
      "--run-all-compositor-stages-before-draw",
      pathToFileURL(htmlPath).href,
    ],
    { encoding: "utf8" },
  );
  // timeout exit 124 = killed; chrome may still have written the PNG.
  if (!existsSync(pngPath)) {
    console.error(r.stderr || r.stdout);
    throw new Error(`Chrome screenshot failed for ${pngPath} (status ${r.status})`);
  }
}

const shots = [
  ["quote-filled-1280", "Quote print preview (company details filled)", parts.filledQuote],
  ["so-filled-1280", "Sales order print preview (company details filled)", parts.filledSo],
  ["billing-filled-1280", "Billing print preview (company details filled)", parts.filledBilling],
  ["quote-empty-address-1280", "Quote print preview (address/TIN empty — no [not set])", parts.emptyAddr],
];

for (const [name, title, inner] of shots) {
  const fixed = inner
    .replaceAll('src="/brand/logo-full.svg"', `src="${logoAbs}"`)
    .replaceAll('src="/files/company-logo"', `src="${logoAbs}"`);
  if (/\[not set/i.test(fixed)) {
    throw new Error(`${name} still contains [not set] text`);
  }
  const htmlPath = path.join(tmpDir, `${name}.html`);
  writeFileSync(htmlPath, shellHtml(fixed, title));
  const pngDocs = path.join(outDocs, `${name}.png`);
  const pngArt = path.join(outArt, `print_fixes_16_${name}.png`);
  shot(htmlPath, pngDocs);
  copyFileSync(pngDocs, pngArt);
  console.log("wrote", name);
}

writeFileSync(
  path.join(outDocs, "README.md"),
  `# Print fixes 16 shots (1280)

Fake sample data only. Captured from ProfessionalPrintDocument fixtures.

| File | What |
| --- | --- |
| quote-filled-1280.png | Quote with company address/TIN filled |
| so-filled-1280.png | Sales order with company address/TIN filled; footer is sales-order wording |
| billing-filled-1280.png | Billing with company address/TIN filled |
| quote-empty-address-1280.png | Quote with empty address/TIN — lines omitted, no red [not set] |
`,
);
console.log("done");
