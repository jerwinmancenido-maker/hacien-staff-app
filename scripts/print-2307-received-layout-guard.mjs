#!/usr/bin/env node
/**
 * 2307-received print layout guard (DOM via Chrome CDP).
 *
 * At 390px on /print/books/tax/2307-received:
 * - every Income cell and Tax Withheld cell in the same row have
 *   non-overlapping bounding boxes (gap >= 0)
 * - Status (2307) cells are fully in-viewport and unclipped
 * - TAX WITHHELD and 2307 header boxes do not overlap
 *
 * Requires a running app on BASE_URL (default http://localhost:3000) and
 * google-chrome-stable. Seed user: jerwin@example.com / SEED_PASSWORD.
 *
 * Usage:
 *   npm run test:print-2307-received-layout
 *   BASE_URL=http://localhost:3000 node scripts/print-2307-received-layout-guard.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";

const CHROME = process.env.CHROME || "/usr/bin/google-chrome-stable";
const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PORT = Number(process.env.GUARD_CDP_PORT || 9415);
const email = process.env.GUARD_EMAIL || "jerwin@example.com";
const password = process.env.GUARD_PASSWORD || process.env.SEED_PASSWORD || "SamplePass123!";
const PATH = "/print/books/tax/2307-received?year=2026&quarter=3";
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

async function setViewport(cdp, w, h = 900) {
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
  await setViewport(cdp, 1280, 900);
  await cdp.send("Network.clearBrowserCookies").catch(() => {});
  await cdp.send("Page.navigate", { url: `${BASE}/login` });
  await sleep(800);
  const state = await cdp.send("Runtime.evaluate", {
    returnByValue: true,
    expression: `({ hasEmail: !!document.querySelector('input[name=email]') })`,
  });
  if (state.result?.value?.hasEmail) {
    await cdp.send("Runtime.evaluate", {
      awaitPromise: true,
      expression: `(() => {
        const e = document.querySelector('input[name=email]');
        const p = document.querySelector('input[name=password]');
        const f = document.querySelector('form');
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
}

async function openPrint(cdp) {
  await setViewport(cdp, VIEWPORT, 1000);
  await cdp.send("Page.navigate", { url: `${BASE}${PATH}` });
  await waitFor(
    cdp,
    `!!document.querySelector('.books-register-table th.col-income') && !!document.querySelector('.books-register-table td.col-income')`,
  );
  await sleep(400);
}

async function measure(cdp) {
  const r = await cdp.send("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      const table = document.querySelector('.books-register-table');
      if (!table) return { ok: false, reason: 'no-table' };
      const vw = window.innerWidth;

      function box(el) {
        const r = el.getBoundingClientRect();
        return {
          left: r.left,
          right: r.right,
          top: r.top,
          bottom: r.bottom,
          width: r.width,
          height: r.height,
          text: (el.innerText || '').trim().slice(0, 40),
        };
      }
      function overlaps(a, b) {
        return !(a.right <= b.left + 0.5 || b.right <= a.left + 0.5 || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5);
      }
      function contentBox(el) {
        // Prefer the text range box so padding gap counts as separation.
        const range = document.createRange();
        range.selectNodeContents(el);
        const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
        if (!rects.length) return box(el);
        let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
        for (const r of rects) {
          left = Math.min(left, r.left);
          right = Math.max(right, r.right);
          top = Math.min(top, r.top);
          bottom = Math.max(bottom, r.bottom);
        }
        return { left, right, top, bottom, width: right - left, height: bottom - top, text: (el.innerText || '').trim().slice(0, 40) };
      }

      const incomeTaxOverlaps = [];
      const rows = [...table.querySelectorAll('tbody tr, tfoot tr')];
      for (const row of rows) {
        const income = row.querySelector('td.col-income');
        const tax = row.querySelector('td.col-tax');
        if (!income || !tax) continue;
        const ib = contentBox(income);
        const tb = contentBox(tax);
        if (overlaps(ib, tb) || ib.right > tb.left + 0.5) {
          incomeTaxOverlaps.push({
            income: ib,
            tax: tb,
            gap: tb.left - ib.right,
          });
        }
      }

      const thIncome = table.querySelector('th.col-income');
      const thTax = table.querySelector('th.col-tax');
      const thStatus = table.querySelector('th.col-status');
      const headerOverlaps = [];
      if (thTax && thStatus) {
        const a = contentBox(thTax);
        const b = contentBox(thStatus);
        if (overlaps(a, b) || a.right > b.left + 0.5) {
          headerOverlaps.push({ taxHeader: a, statusHeader: b, gap: b.left - a.right });
        }
      }
      if (thIncome && thTax) {
        const a = contentBox(thIncome);
        const b = contentBox(thTax);
        if (overlaps(a, b) || a.right > b.left + 0.5) {
          headerOverlaps.push({ incomeHeader: a, taxHeader: b, gap: b.left - a.right });
        }
      }

      const statusIssues = [...table.querySelectorAll('td.col-status')]
        .filter((el) => (el.innerText || '').trim().length > 0)
        .map((el) => {
          const r = el.getBoundingClientRect();
          const selfClip = el.scrollWidth > el.clientWidth + 1;
          const outOfView = r.right > vw + 0.5 || r.left < -0.5;
          if (!selfClip && !outOfView && r.width > 0) return null;
          return {
            text: (el.innerText || '').trim(),
            right: r.right,
            left: r.left,
            vw,
            selfClip,
            scrollWidth: el.scrollWidth,
            clientWidth: el.clientWidth,
          };
        })
        .filter(Boolean);

      const tinLines = [...table.querySelectorAll('td.col-tin')].map((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const lines = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0).length;
        return { text: (el.innerText || '').trim(), lines };
      });
      const tinTooTall = tinLines.filter((t) => t.lines > 2);

      return {
        ok: true,
        vw,
        rowCount: rows.length,
        incomeTaxOverlaps,
        headerOverlaps,
        statusIssues,
        tinTooTall,
        tinSample: tinLines.slice(0, 3),
        thTaxText: thTax ? (thTax.innerText || '').trim() : null,
        thStatusText: thStatus ? (thStatus.innerText || '').trim() : null,
      };
    })()`,
  });
  return r.result?.value;
}

async function main() {
  if (!fs.existsSync(CHROME)) {
    console.error("CHROME_MISSING", CHROME);
    process.exit(2);
  }
  fs.rmSync(`/tmp/print-2307-received-layout-guard`, { recursive: true, force: true });
  const chrome = spawn(
    CHROME,
    [
      `--remote-debugging-port=${PORT}`,
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      `--user-data-dir=/tmp/print-2307-received-layout-guard`,
      "--window-size=500,1100",
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
  await login(cdp);
  await openPrint(cdp);
  const m = await measure(cdp);
  console.log("viewport", VIEWPORT, JSON.stringify(m, null, 2));

  let failed = false;
  if (!m?.ok) {
    console.error("FAIL: measure failed", m);
    failed = true;
  }
  if (m?.incomeTaxOverlaps?.length) {
    console.error("FAIL: Income/Tax Withheld boxes overlap:", JSON.stringify(m.incomeTaxOverlaps));
    failed = true;
  }
  if (m?.headerOverlaps?.length) {
    console.error("FAIL: headers overlap:", JSON.stringify(m.headerOverlaps));
    failed = true;
  }
  if (m?.statusIssues?.length) {
    console.error("FAIL: Status not fully visible:", JSON.stringify(m.statusIssues));
    failed = true;
  }
  if (m?.tinTooTall?.length) {
    console.error("FAIL: TIN wraps more than 2 lines:", JSON.stringify(m.tinTooTall));
    failed = true;
  }

  cdp.close();
  chrome.kill("SIGKILL");
  if (failed) {
    console.error("PRINT_2307_RECEIVED_LAYOUT_GUARD_FAIL");
    process.exit(1);
  }
  console.log("PRINT_2307_RECEIVED_LAYOUT_GUARD_PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
