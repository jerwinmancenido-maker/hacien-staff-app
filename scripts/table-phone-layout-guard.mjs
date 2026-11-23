#!/usr/bin/env node
/**
 * Phone table layout regression guard (DOM via Chrome CDP) — VR1 D12.
 *
 * At a 390px phone viewport, on each route whose wide table used to slice a
 * money/status/date column at the screen edge, assert the flagged column's
 * header bounding box lies fully inside the viewport, and that the columns
 * demoted with .col-phone-hide are actually hidden:
 *
 * - /sales-orders      SO list: "Total" + "Status" visible; "Buyer PO" +
 *                      "Date" phone-hidden by design (batch-B treatment)
 * - /books/sales       Sales register: "EWT" never half-cut (notcut)
 * - /books/disbursements  Cash disbursements register: "EWT" notcut
 * - quote detail       Items table: "Total" visible
 * - /billing           AR by customer: "Total" visible; aging buckets hidden
 * - /billing/2307      2307 list: "Status" visible; "Collection" hidden
 * - /books/profit      Margin by deal: "Margin" + "Margin %" visible
 *
 * Extended for the class-first table treatment (findings 1026/1045) — the
 * guard now covers the whole census family, not just the D12 screens:
 *
 * STATIC CONTRACT (no browser): the shared mechanism in globals.css must
 * stay ONE rule — the unified value-column nowrap set (td.num + the
 * protected data-col keys), the retired per-table patch selectors must
 * stay gone, the table.list min-width floor must stay capped at the wrap
 * width, and .file-input must stay position:relative (the page-widening
 * escape behind the /payables/2307 phone overflow). Every literal
 * data-col="..." key used under src/ must be classified: protected
 * (nowrap), "record" (structural, own rules), or a known prose key —
 * an unclassified key fails the guard, so a new list cannot silently
 * join the wrap family.
 *
 * LIVE, phone 390px, additionally: billings "Status" visible (SO +
 * Invoice date + Due + Amount hidden), collections "Status" notcut, supplier
 * payments "Status" notcut, cash ledger "Balance" notcut, items
 * "Default price" visible (Category hidden), Books operations "Profit"
 * visible (Supplier costs hidden). "notcut" = fully on screen or fully
 * off it (wide tables scroll by design), never straddling the edge.
 *
 * LIVE, tablet 768px: SO list "Date" visible (Buyer PO hidden), billings
 * "Status" visible with SO + Invoice date hidden, Books sales +
 * disbursements registers "EWT" notcut, Books profit "Margin %" notcut, quotes "Valid until"
 * visible (Rev + Margin % hidden), receiving "Expected" visible (Sales
 * order hidden), Books journal "EWT" visible (Party hidden), cash
 * ledger "Balance" visible (Type hidden).
 *
 * Requires a running app on BASE_URL (default http://localhost:3000) with
 * seeded sample data and google-chrome-stable. Logs in as the cost user
 * (jerwin@example.com) so cost columns render. Password: SEED_PASSWORD or
 * SamplePass123!.
 *
 * Usage:
 *   npm run test:table-phone-layout
 *   BASE_URL=http://localhost:3000 node scripts/table-phone-layout-guard.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* The protected data-col vocabulary of the unified table treatment
 * (globals.css). Mirrored here on purpose: the static check below parses
 * the CSS rule itself and fails if the two ever drift apart. */
const PROTECTED_KEYS = [
  "number", "date", "valid", "status", "when", "who", "method", "action",
  "so", "po", "expected", "sku", "price", "total", "margin", "rev", "atc",
];
/* Structural key with its own dedicated rules in globals.css. */
const STRUCTURAL_KEYS = ["record"];
/* Prose keys: columns that wrap by design (names, parties, descriptions).
 * A literal data-col key in src/ that is in NONE of the three sets fails
 * the guard — classify it here (with a reason in the PR) or protect it. */
const PROSE_KEYS = [
  "customer", "supplier", "party", "particulars", "description", "item",
  "brand", "category", "name", "detail", "business", "line", "source",
];

function staticChecks() {
  const failures = [];
  const fail = (msg) => failures.push(msg);
  const css = fs.readFileSync(path.join(REPO_ROOT, "src/app/globals.css"), "utf8");

  /* The unified rule: one selector group carrying td.num + every
   * protected data-col key with white-space: nowrap. */
  const ruleMatch = css.match(/table\.list td\.num,[\s\S]*?\{[^}]*white-space:\s*nowrap;[^}]*\}/);
  if (!ruleMatch) {
    fail("globals.css: unified value-column nowrap rule (table.list td.num, ...) not found");
  } else {
    const keysInCss = [...ruleMatch[0].matchAll(/td\[data-col="([a-z-]+)"\]/g)].map((m) => m[1]);
    for (const k of PROTECTED_KEYS) {
      if (!keysInCss.includes(k)) fail(`globals.css: protected key "${k}" missing from the unified nowrap rule`);
    }
    for (const k of keysInCss) {
      if (!PROTECTED_KEYS.includes(k)) fail(`globals.css: key "${k}" is in the unified rule but not in the guard's PROTECTED_KEYS`);
    }
  }

  /* The retired per-table patches must stay retired (class-first). */
  for (const sel of ["aging-table td[data-col", "billing-list-table td[data-col", "so-list-table table.list td[data-col"]) {
    if (css.includes(sel)) fail(`globals.css: retired per-table patch selector "${sel}..." is back — use the unified rule`);
  }

  /* The min-width floor must stay capped at the wrap width. Only rules
   * that set the 640px floor are in scope (other .table-wrap table.list
   * rules legitimately override min-width to 0 in card/print contexts). */
  const floors = [...css.matchAll(/\.table-wrap[^{]*table\.list\s*\{[^}]*min-width:\s*([^;]+);/g)]
    .map((m) => m[1])
    .filter((v) => v.includes("640"));
  if (!floors.length || floors.some((f) => !f.includes("min("))) {
    fail(`globals.css: a 640px table.list min-width floor is not capped with min(...) — found: ${floors.join(" | ") || "none"}`);
  }

  /* .file-input must contain its hidden input (page-widening escape). */
  const fileInput = css.match(/\.file-input\s*\{[^}]*\}/);
  if (!fileInput || !/position:\s*relative/.test(fileInput[0])) {
    fail("globals.css: .file-input lost position:relative — its hidden input escapes and widens the page");
  }

  /* data-col literal census under src/: every key classified. */
  const srcRoot = path.join(REPO_ROOT, "src");
  const literalKeys = new Set();
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name)) {
        const text = fs.readFileSync(p, "utf8");
        for (const m of text.matchAll(/data-col="([a-z-]+)"/g)) literalKeys.add(m[1]);
      }
    }
  };
  walk(srcRoot);
  const known = new Set([...PROTECTED_KEYS, ...STRUCTURAL_KEYS, ...PROSE_KEYS]);
  for (const k of literalKeys) {
    if (!known.has(k)) fail(`src: data-col="${k}" is unclassified — add it to the guard's PROTECTED/STRUCTURAL/PROSE sets (and to the CSS rule if it is a value column)`);
  }

  /* The DataTable dynamic path must stay wired (data-col={c.key}). */
  const dataTable = fs.readFileSync(path.join(srcRoot, "components/DataTable.tsx"), "utf8");
  if (!dataTable.includes("data-col={c.key}")) {
    fail("DataTable.tsx: data-col={c.key} wiring missing — DataTable lists lost their column classification");
  }

  return failures;
}

const CHROME = process.env.CHROME || "/usr/bin/google-chrome-stable";
const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PORT = Number(process.env.GUARD_CDP_PORT || 9414);
const email = process.env.GUARD_EMAIL || "jerwin@example.com";
const password = process.env.GUARD_PASSWORD || process.env.SEED_PASSWORD || "SamplePass123!";
const VIEWPORT = 390;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

class Cdp {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 0;
    this.pending = new Map();
  }
  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((res, rej) => {
      this.ws.addEventListener("open", res);
      this.ws.addEventListener("error", rej);
    });
    this.ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString());
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  close() {
    this.ws.close();
  }
}

async function waitFor(cdp, expression, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.value) return r.result.value;
    await sleep(200);
  }
  throw new Error("waitFor timeout: " + expression);
}

async function setViewport(cdp, w, h = 844) {
  await cdp.send("Emulation.clearDeviceMetricsOverride").catch(() => {});
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: w,
    height: h,
    deviceScaleFactor: 1,
    mobile: w < 640,
    screenWidth: w,
    screenHeight: h,
  });
}

async function login(cdp) {
  await setViewport(cdp, VIEWPORT, 844);
  await cdp.send("Network.clearBrowserCookies").catch(() => {});
  await cdp.send("Page.navigate", { url: `${BASE}/login` });
  await sleep(800);
  await cdp.send("Runtime.evaluate", {
    awaitPromise: true,
    expression: `(() => {
      const e = document.querySelector('input[name=email]');
      const p = document.querySelector('input[name=password]');
      const f = document.querySelector('form');
      if (!e || !p || !f) return false;
      const set = (el, v) => {
        const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        d.set.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set(e, ${JSON.stringify(email)});
      set(p, ${JSON.stringify(password)});
      f.requestSubmit();
      return true;
    })()`,
  });
  await waitFor(cdp, `!location.pathname.includes('/login')`);
}

/** Bounding box + visibility of one header cell, found by exact label text. */
function headerProbeExpr(tableSelector, label) {
  return `(() => {
    const table = document.querySelector(${JSON.stringify(tableSelector)});
    if (!table) return { missing: true };
    const th = [...table.querySelectorAll('thead th')].find(
      /* textContent, NOT innerText: th is styled text-transform: uppercase
       * and innerText returns the TRANSFORMED text for rendered cells
       * ("Status" -> "STATUS"), which silently broke every Title-Case
       * label probe. textContent is the source text in all states. */
      (h) => (h.textContent || '').trim().replace(/\\s+/g, ' ') === ${JSON.stringify(label)},
    );
    if (!th) return { missing: true, reason: 'no-header' };
    const r = th.getBoundingClientRect();
    return {
      iw: innerWidth,
      display: getComputedStyle(th).display,
      left: Math.round(r.left * 10) / 10,
      right: Math.round(r.right * 10) / 10,
      width: Math.round(r.width * 10) / 10,
    };
  })()`;
}

async function probeHeader(cdp, route, tableSelector, label) {
  await cdp.send("Page.navigate", { url: `${BASE}${route}` });
  await waitFor(cdp, `!!document.querySelector(${JSON.stringify(tableSelector)})`);
  await sleep(300);
  const r = await cdp.send("Runtime.evaluate", {
    returnByValue: true,
    expression: headerProbeExpr(tableSelector, label),
  });
  return r.result?.value;
}

async function openFirstQuote(cdp) {
  await cdp.send("Page.navigate", { url: `${BASE}/quotes` });
  const href = await waitFor(
    cdp,
    `(() => {
        const a = [...document.querySelectorAll('a[href^="/quotes/"]')].find((x) => {
          const href = x.getAttribute('href') || '';
          /* The bare segment must be a record id: "/quotes/new" (the New
           * quote button) matches the id shape but is the create page,
           * which has no items table — exclude it explicitly. */
          return /^\\/quotes\\/[a-z0-9]+$/i.test(href) && href !== '/quotes/new';
        });
      return a ? a.getAttribute('href') : null;
    })()`,
  );
  await cdp.send("Page.navigate", { url: `${BASE}${href}` });
  await waitFor(cdp, `!!document.querySelector('.items-table table.list')`);
  await sleep(300);
  const r = await cdp.send("Runtime.evaluate", {
    returnByValue: true,
    expression: headerProbeExpr(".items-table table.list", "Total"),
  });
  return { route: href, ...(r.result?.value || { missing: true }) };
}

const CHECKS = [
  /* Batch-B phone treatment (PR #276) supersedes the D12-era expectation
   * for this screen: Buyer PO and Date are phone-hidden BY DESIGN; the
   * last visible column at 390 is Status. */
  { route: "/sales-orders", table: ".table-wrap table.list", visible: ["Total", "Status"], hidden: ["Buyer PO", "Date"] },
  { route: "/books/sales", table: 'table.list[aria-label="Sales register"]', visible: [], hidden: [], notcut: ["EWT"] },
  { route: "/books/disbursements", table: 'table.list[aria-label="Cash disbursements register"]', visible: [], hidden: [], notcut: ["EWT"] },
  { route: "/billing", table: 'table.list[aria-label="AR by customer"]', visible: ["Total"], hidden: ["Current"] },
  { route: "/billing/2307", table: 'table.list[aria-label="2307s"]', visible: ["Status"], hidden: ["Collection", "Received"] },
  {
    route: "/books/profit",
    table: 'table.list[aria-label="Margin by deal"]',
    visible: ["Margin", "Margin %"],
    hidden: ["Returns", "Supplier cost"],
  },
  /* Census-family additions (findings 1026/1045): last columns that sat
   * half-cut at the wrap edge on the phone before the unified treatment. */
  { route: "/billing/billings", table: "table.list.billing-list-table", visible: ["Status"], hidden: ["SO", "Invoice date", "Due", "Amount"] },
  { route: "/billing/collections", table: "table.list.collections-table", visible: [], hidden: [], notcut: ["Status"] },
  { route: "/payables/payments", table: ".table-wrap table.list", visible: [], hidden: [], notcut: ["Status"] },
  { route: "/cash/ledger", table: ".table-wrap table.list", visible: [], hidden: ["Description"], notcut: ["Balance"] },
  { route: "/items", table: ".table-wrap table.list", visible: ["Default price"], hidden: ["Category"] },
  { route: "/books/operations", table: ".table-wrap table.list", visible: ["Profit"], hidden: ["Supplier costs"] },
];

/* Tablet width (768px): the col-tab-hide demotions act at <=860px, so the
 * surviving last columns must sit fully on screen here too. */
const TABLET_CHECKS = [
  { route: "/sales-orders", table: ".table-wrap table.list", visible: ["Date"], hidden: ["Buyer PO"] },
  { route: "/billing/billings", table: "table.list.billing-list-table", visible: ["Status"], hidden: ["SO", "Invoice date", "Due"] },
  { route: "/books/sales", table: 'table.list[aria-label="Sales register"]', visible: [], hidden: [], notcut: ["EWT"] },
  { route: "/books/disbursements", table: 'table.list[aria-label="Cash disbursements register"]', visible: [], hidden: [], notcut: ["EWT"] },
  {
    route: "/books/profit",
    table: 'table.list[aria-label="Margin by deal"]',
    visible: [],
    hidden: [],
    notcut: ["Margin %"],
  },
  { route: "/quotes", table: ".table-wrap table.list", visible: ["Valid until"], hidden: ["Rev", "Margin %"] },
  { route: "/receiving", table: ".table-wrap table.list", visible: ["Expected"], hidden: ["Sales order"] },
  { route: "/books/journal", table: 'table.list[aria-label="General journal"]', visible: ["EWT"], hidden: ["Party"] },
  { route: "/cash/ledger", table: ".table-wrap table.list", visible: ["Balance"], hidden: ["Type"] },
];

async function main() {
  const staticFailures = staticChecks();
  if (staticFailures.length) {
    for (const f of staticFailures) console.error(`STATIC FAIL ${f}`);
    console.error("TABLE_PHONE_LAYOUT_GUARD_FAIL");
    process.exit(1);
  }
  console.log("STATIC CONTRACT OK (unified nowrap rule, capped floor, file-input containment, data-col census)");

  if (!fs.existsSync(CHROME)) {
    console.error("CHROME_MISSING", CHROME);
    process.exit(2);
  }
  fs.rmSync(`/tmp/table-phone-layout-guard`, { recursive: true, force: true });
  const chrome = spawn(
    CHROME,
    [
      `--remote-debugging-port=${PORT}`,
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      `--user-data-dir=/tmp/table-phone-layout-guard`,
      "--window-size=500,900",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  let tabs;
  for (let i = 0; i < 50; i++) {
    try {
      tabs = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      if (tabs?.length) break;
    } catch {}
    await sleep(120);
  }
  if (!tabs?.length) {
    chrome.kill("SIGKILL");
    console.error("CDP_CONNECT_FAIL");
    process.exit(2);
  }
  const page = tabs.find((t) => t.type === "page") || tabs[0];
  const cdp = new Cdp(page.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");

  await login(cdp);
  await setViewport(cdp, VIEWPORT, 844);

  const report = [];
  let failed = false;

  const runChecks = async (checks, viewportLabel) => {
    for (const check of checks) {
      for (const label of check.visible) {
        const m = await probeHeader(cdp, check.route, check.table, label);
        report.push({ viewport: viewportLabel, route: check.route, column: label, expect: "visible", ...m });
        console.log(`viewport ${viewportLabel} ${check.route} "${label}"`, JSON.stringify(m));
        if (m.missing) {
          console.error(`FAIL ${check.route}: table/header "${label}" missing`);
          failed = true;
        } else if (m.display === "none" || m.left < -1 || m.right > m.iw + 1) {
          console.error(`FAIL ${check.route}: "${label}" not fully on screen:`, JSON.stringify(m));
          failed = true;
        }
      }
      for (const label of check.hidden) {
        const m = await probeHeader(cdp, check.route, check.table, label);
        report.push({ viewport: viewportLabel, route: check.route, column: label, expect: "hidden", ...m });
        console.log(`viewport ${viewportLabel} ${check.route} "${label}" (hidden)`, JSON.stringify(m));
        if (m.missing) {
          console.error(`FAIL ${check.route}: header "${label}" missing (cannot verify it hides)`);
          failed = true;
        } else if (m.display !== "none") {
          console.error(`FAIL ${check.route}: "${label}" should be hidden at viewport ${viewportLabel}:`, JSON.stringify(m));
          failed = true;
        }
      }
      /* notcut: the column may sit fully on screen or fully off it (wide
       * tables scroll by design), but it must never STRADDLE the edge —
       * a half-cut column is finding 1026's defect. */
      for (const label of check.notcut || []) {
        const m = await probeHeader(cdp, check.route, check.table, label);
        report.push({ viewport: viewportLabel, route: check.route, column: label, expect: "notcut", ...m });
        console.log(`viewport ${viewportLabel} ${check.route} "${label}" (notcut)`, JSON.stringify(m));
        if (m.missing) {
          console.error(`FAIL ${check.route}: header "${label}" missing (cannot verify it is not cut)`);
          failed = true;
        } else if (m.display === "none") {
          console.error(`FAIL ${check.route}: "${label}" is hidden but should be present (visible or scrolled):`, JSON.stringify(m));
          failed = true;
        } else if (m.left < m.iw - 1 && m.right > m.iw + 1) {
          console.error(`FAIL ${check.route}: "${label}" straddles the screen edge (half-cut):`, JSON.stringify(m));
          failed = true;
        }
      }
    }
  };

  await runChecks(CHECKS, VIEWPORT);

  const quote = await openFirstQuote(cdp);
  report.push({ route: quote.route, column: "Total", expect: "visible", ...quote });
  console.log(`viewport ${VIEWPORT} ${quote.route} "Total"`, JSON.stringify(quote));
  if (quote.missing) {
    console.error(`FAIL quote detail: items table/Total missing`);
    failed = true;
  } else if (quote.display === "none" || quote.left < -1 || quote.right > quote.iw + 1) {
    console.error(`FAIL quote detail: "Total" not fully on screen:`, JSON.stringify(quote));
    failed = true;
  }

  await setViewport(cdp, 768, 844);
  await runChecks(TABLET_CHECKS, 768);

  cdp.close();
  chrome.kill("SIGKILL");
  if (failed) {
    console.error("TABLE_PHONE_LAYOUT_GUARD_FAIL");
    process.exit(1);
  }
  console.log("TABLE_PHONE_LAYOUT_GUARD_PASS");
  console.log(JSON.stringify({ viewports: [VIEWPORT, 768], checks: report }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
