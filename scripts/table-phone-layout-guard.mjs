#!/usr/bin/env node
/**
 * Phone table layout regression guard (DOM via Chrome CDP) — VR1 D12.
 *
 * At a 390px phone viewport, on each route whose wide table used to slice a
 * money/status/date column at the screen edge, assert the flagged column's
 * header bounding box lies fully inside the viewport, and that the columns
 * demoted with .col-phone-hide are actually hidden:
 *
 * - /sales-orders      SO list: "Date" visible; "Buyer PO" hidden
 * - /books/sales       Sales register: "EWT" visible (Particulars is capped)
 * - quote detail       Items table: "Total" visible
 * - /billing           AR by customer: "Total" visible; aging buckets hidden
 * - /billing/2307      2307 list: "Status" visible; "Collection" hidden
 * - /books/profit      Margin by deal: "Margin" + "Margin %" visible
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
      (h) => (h.innerText || '').trim().replace(/\\s+/g, ' ') === ${JSON.stringify(label)},
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
      const a = [...document.querySelectorAll('a[href^="/quotes/"]')].find((x) =>
        /^\\/quotes\\/[a-z0-9]+$/i.test(x.getAttribute('href') || ''),
      );
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
  { route: "/sales-orders", table: ".table-wrap table.list", visible: ["Date"], hidden: ["Buyer PO"] },
  { route: "/books/sales", table: 'table.list[aria-label="Sales register"]', visible: ["EWT"], hidden: [] },
  { route: "/billing", table: 'table.list[aria-label="AR by customer"]', visible: ["Total"], hidden: ["Current"] },
  { route: "/billing/2307", table: 'table.list[aria-label="2307s"]', visible: ["Status"], hidden: ["Collection", "Received"] },
  {
    route: "/books/profit",
    table: 'table.list[aria-label="Margin by deal"]',
    visible: ["Margin", "Margin %"],
    hidden: ["Returns", "Supplier cost"],
  },
];

async function main() {
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

  for (const check of CHECKS) {
    for (const label of check.visible) {
      const m = await probeHeader(cdp, check.route, check.table, label);
      report.push({ route: check.route, column: label, expect: "visible", ...m });
      console.log(`viewport ${VIEWPORT} ${check.route} "${label}"`, JSON.stringify(m));
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
      report.push({ route: check.route, column: label, expect: "hidden", ...m });
      console.log(`viewport ${VIEWPORT} ${check.route} "${label}" (hidden)`, JSON.stringify(m));
      if (m.missing) {
        console.error(`FAIL ${check.route}: header "${label}" missing (cannot verify it hides)`);
        failed = true;
      } else if (m.display !== "none") {
        console.error(`FAIL ${check.route}: "${label}" should be hidden on phone:`, JSON.stringify(m));
        failed = true;
      }
    }
  }

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

  cdp.close();
  chrome.kill("SIGKILL");
  if (failed) {
    console.error("TABLE_PHONE_LAYOUT_GUARD_FAIL");
    process.exit(1);
  }
  console.log("TABLE_PHONE_LAYOUT_GUARD_PASS");
  console.log(JSON.stringify({ viewport: VIEWPORT, checks: report }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
