#!/usr/bin/env node
/**
 * Items editor layout regression guard (DOM via Chrome CDP).
 *
 * At 1280px, for both cost and non-cost quote editors:
 * - every Items th/td has scrollWidth <= clientWidth (nothing clipped)
 * - no two cells in the same row have overlapping content boxes
 * - table wrapper has no horizontal scroll
 *
 * Uses a long description and ₱999,999.99-scale amounts.
 *
 * Requires a running app on BASE_URL (default http://localhost:3000) and
 * google-chrome-stable. Cost user: jerwin@example.com; non-cost: staff@example.com.
 * Password: SEED_PASSWORD or TestPass123!.
 *
 * Usage:
 *   npm run test:items-edit-layout
 *   BASE_URL=http://localhost:3000 node scripts/items-edit-layout-guard.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";

const CHROME = process.env.CHROME || "/usr/bin/google-chrome-stable";
const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PORT = Number(process.env.GUARD_CDP_PORT || 9413);
const costEmail = process.env.GUARD_COST_EMAIL || "jerwin@example.com";
const staffEmail = process.env.GUARD_STAFF_EMAIL || "staff@example.com";
const password = process.env.GUARD_PASSWORD || process.env.SEED_PASSWORD || "SamplePass123!";
const VIEWPORT = 1280;
const LONG_DESC =
  "Professional laptop workstation bundle with docking station, spare battery, and multi-year onsite support plan";

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

async function login(cdp, email) {
  await setViewport(cdp, VIEWPORT, 900);
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

function reactChangeSelectExpr(labelSubstr) {
  return `(() => {
    const sel = document.querySelector('select#customerId, select[name="customerId"]');
    if (!sel) return { ok: false, reason: 'no-select' };
    const opt = [...sel.options].find((o) => (o.textContent || '').includes(${JSON.stringify(labelSubstr)}));
    if (!opt) return { ok: false, reason: 'no-option' };
    const d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    d.set.call(sel, opt.value);
    const fiberKey = Object.keys(sel).find((k) => k.startsWith('__reactFiber$'));
    const propsKey = Object.keys(sel).find((k) => k.startsWith('__reactProps$'));
    const fiber = fiberKey ? sel[fiberKey] : null;
    const onChange = fiber?.memoizedProps?.onChange || (propsKey ? sel[propsKey]?.onChange : null);
    if (typeof onChange === 'function') {
      onChange({ target: sel, currentTarget: sel, type: 'change', bubbles: true, preventDefault() {}, stopPropagation() {} });
    } else {
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return { ok: true, value: opt.value, viaReact: typeof onChange === 'function' };
  })()`;
}

async function selectCustomer(cdp, labelSubstr) {
  const r = await cdp.send("Runtime.evaluate", {
    awaitPromise: true,
    returnByValue: true,
    expression: reactChangeSelectExpr(labelSubstr),
  });
  await sleep(700);
  return r.result?.value;
}

async function fillStressLines(cdp) {
  await cdp.send("Runtime.evaluate", {
    awaitPromise: true,
    expression: `(() => {
      const set = (el, v) => {
        if (!el) return;
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const d = Object.getOwnPropertyDescriptor(proto, 'value');
        d.set.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const add = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Add line');
      if (add && !document.querySelector('textarea[aria-label="Line 2 description"]')) add.click();
      set(document.querySelector('textarea[aria-label="Line 1 description"]'), ${JSON.stringify(LONG_DESC)});
      set(document.querySelector('input[aria-label="Line 1 HACIEN unit price"]'), '999999.99');
      set(document.querySelector('input[aria-label="Line 1 supplier unit cost"]'), '999999.99');
      set(document.querySelector('input[aria-label="Line 1 qty"]'), '1');
      return true;
    })()`,
  });
  await sleep(350);
  await cdp.send("Runtime.evaluate", {
    awaitPromise: true,
    expression: `(() => {
      const set = (el, v) => {
        if (!el) return;
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const d = Object.getOwnPropertyDescriptor(proto, 'value');
        d.set.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const k1 = document.querySelector('select[aria-label="Line 2 kind"]');
      if (k1) {
        const d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
        d.set.call(k1, 'SERVICES');
        const fiberKey = Object.keys(k1).find((k) => k.startsWith('__reactFiber$'));
        const propsKey = Object.keys(k1).find((k) => k.startsWith('__reactProps$'));
        const fiber = fiberKey ? k1[fiberKey] : null;
        const onChange = fiber?.memoizedProps?.onChange || (propsKey ? k1[propsKey]?.onChange : null);
        if (typeof onChange === 'function') {
          onChange({ target: k1, currentTarget: k1, type: 'change', bubbles: true, preventDefault() {}, stopPropagation() {} });
        } else {
          k1.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      set(document.querySelector('textarea[aria-label="Line 2 description"]'), ${JSON.stringify(LONG_DESC + " — install")});
      set(document.querySelector('input[aria-label="Line 2 HACIEN unit price"]'), '999999.99');
      set(document.querySelector('input[aria-label="Line 2 supplier unit cost"]'), '888888.88');
      return true;
    })()`,
  });
  await sleep(400);
}

async function measure(cdp) {
  const r = await cdp.send("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      const wrap = document.querySelector('.edit-table.items-edit');
      const table = wrap && wrap.querySelector('table.list');
      if (!wrap || !table) return { missing: true };

      const clipped = [];
      const cells = [...table.querySelectorAll('th, td')];
      for (const cell of cells) {
        // Ignore empty action header; measure visible text/control overflow.
        if (cell.scrollWidth > cell.clientWidth + 1) {
          clipped.push({
            tag: cell.tagName,
            className: cell.className,
            text: (cell.innerText || '').trim().slice(0, 40),
            scrollWidth: cell.scrollWidth,
            clientWidth: cell.clientWidth,
          });
        }
        for (const child of cell.querySelectorAll('input, select, textarea')) {
          if (child.scrollWidth > child.clientWidth + 1) {
            clipped.push({
              tag: child.tagName,
              aria: child.getAttribute('aria-label'),
              value: (child.value || '').slice(0, 24),
              scrollWidth: child.scrollWidth,
              clientWidth: child.clientWidth,
            });
          }
        }
      }

      const overlaps = [];
      for (const row of table.querySelectorAll('tr')) {
        const rowCells = [...row.children].filter((el) => el.tagName === 'TH' || el.tagName === 'TD');
        for (let i = 0; i < rowCells.length; i++) {
          for (let j = i + 1; j < rowCells.length; j++) {
            const a = rowCells[i].getBoundingClientRect();
            const b = rowCells[j].getBoundingClientRect();
            const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (overlapX > 0.5 && overlapY > 0.5) {
              overlaps.push({
                i,
                j,
                overlapX: Math.round(overlapX * 10) / 10,
                a: (rowCells[i].innerText || '').trim().slice(0, 24),
                b: (rowCells[j].innerText || '').trim().slice(0, 24),
              });
            }
          }
        }
      }

      // Painted money text must not spill into the next cell.
      const paintSpill = [];
      for (const cell of table.querySelectorAll('td.col-money, th.col-money')) {
        const range = document.createRange();
        range.selectNodeContents(cell);
        for (const rect of range.getClientRects()) {
          const cr = cell.getBoundingClientRect();
          if (rect.right > cr.right + 0.5 || rect.left < cr.left - 0.5) {
            paintSpill.push({
              text: (cell.innerText || '').trim().slice(0, 24),
              cellRight: cr.right,
              textRight: rect.right,
            });
            break;
          }
        }
      }

      return {
        iw: innerWidth,
        wrapScrollWidth: wrap.scrollWidth,
        wrapClientWidth: wrap.clientWidth,
        hasHScroll: wrap.scrollWidth > wrap.clientWidth + 1,
        clipped,
        overlaps,
        paintSpill,
        thText: [...table.querySelectorAll('thead th')].map((th) => th.innerText.trim().replace(/\\s+/g, ' ')),
        kindShown: [...table.querySelectorAll('select[aria-label$=" kind"]')].map((s) => {
          const opt = s.selectedOptions[0];
          const label = opt ? opt.text : '';
          const cs = getComputedStyle(s);
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          ctx.font = cs.font;
          const textW = ctx.measureText(label).width;
          // Native select chrome (padding + dropdown arrow) ≈ 18px in this UI.
          const textOverflows = textW + 18 > s.clientWidth + 1;
          return {
            value: s.value,
            label,
            clientWidth: s.clientWidth,
            scrollWidth: s.scrollWidth,
            textW: Math.round(textW),
            textOverflows,
          };
        }),
        moneySample: [...table.querySelectorAll('td.col-money')].slice(0, 6).map((td) => ({
          text: (td.innerText || td.querySelector('input')?.value || '').trim(),
          clientWidth: td.clientWidth,
          scrollWidth: td.scrollWidth,
        })),
      };
    })()`,
  });
  return r.result?.value;
}

async function openQuoteEditor(cdp) {
  await setViewport(cdp, VIEWPORT, 900);
  await cdp.send("Page.navigate", { url: `${BASE}/quotes/new` });
  await waitFor(cdp, `!!document.querySelector('.edit-table.items-edit')`);
  await selectCustomer(cdp, "Sample Corp");
  await fillStressLines(cdp);
  await cdp.send("Runtime.evaluate", {
    expression: `document.querySelector('.edit-table.items-edit')?.scrollIntoView({ block: 'center' })`,
  });
  await sleep(300);
}

async function main() {
  if (!fs.existsSync(CHROME)) {
    console.error("CHROME_MISSING", CHROME);
    process.exit(2);
  }
  fs.rmSync(`/tmp/items-edit-layout-guard`, { recursive: true, force: true });
  const chrome = spawn(
    CHROME,
    [
      `--remote-debugging-port=${PORT}`,
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      `--user-data-dir=/tmp/items-edit-layout-guard`,
      "--window-size=1400,1000",
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

  const report = [];
  let failed = false;

  for (const [label, email] of [
    ["cost", costEmail],
    ["non-cost", staffEmail],
  ]) {
    await login(cdp, email);
    await openQuoteEditor(cdp);
    const m = await measure(cdp);
    report.push({ view: label, ...m });
    console.log(`viewport ${VIEWPORT} ${label}`, JSON.stringify(m));
    if (m.missing) {
      console.error(`FAIL ${label}: items-edit missing`);
      failed = true;
      continue;
    }
    if (m.hasHScroll) {
      console.error(`FAIL ${label}: H-scroll ${m.wrapScrollWidth}/${m.wrapClientWidth}`);
      failed = true;
    }
    if (m.clipped?.length) {
      console.error(`FAIL ${label}: clipped cells:`, JSON.stringify(m.clipped));
      failed = true;
    }
    if (m.overlaps?.length) {
      console.error(`FAIL ${label}: overlapping cells:`, JSON.stringify(m.overlaps));
      failed = true;
    }
    if (m.paintSpill?.length) {
      console.error(`FAIL ${label}: money paint spill:`, JSON.stringify(m.paintSpill));
      failed = true;
    }
    for (const k of m.kindShown || []) {
      if (k.scrollWidth > k.clientWidth + 1 || k.textOverflows) {
        console.error(`FAIL ${label}: Kind select truncated:`, JSON.stringify(k));
        failed = true;
      }
    }
  }

  cdp.close();
  chrome.kill("SIGKILL");
  if (failed) {
    console.error("ITEMS_EDIT_LAYOUT_GUARD_FAIL");
    process.exit(1);
  }
  console.log("ITEMS_EDIT_LAYOUT_GUARD_PASS");
  console.log(JSON.stringify({ viewports: report }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
