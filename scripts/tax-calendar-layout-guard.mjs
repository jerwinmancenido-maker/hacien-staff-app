#!/usr/bin/env node
/**
 * Tax calendar layout regression guard (DOM via Chrome CDP).
 *
 * Checks at 360, 1024 and 1280:
 * - every due-date / file-by-date node is a single line box
 * - every status/applies chip is unclipped (scrollWidth <= clientWidth)
 * - desktop table wrapper has no horizontal scroll (scrollWidth <= clientWidth)
 *
 * Requires a running app on BASE_URL (default http://localhost:3000) and
 * google-chrome-stable. Seed user: jerwin@example.com / SEED_PASSWORD or TestPass123!.
 *
 * Usage:
 *   npm run test:tax-cal-layout
 *   BASE_URL=http://localhost:3000 node scripts/tax-calendar-layout-guard.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";

const CHROME = process.env.CHROME || "/usr/bin/google-chrome-stable";
const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PORT = Number(process.env.GUARD_CDP_PORT || 9411);
const email = process.env.GUARD_EMAIL || "jerwin@example.com";
const password = process.env.GUARD_PASSWORD || process.env.SEED_PASSWORD || "TestPass123!";
const VIEWPORTS = [360, 1024, 1280];

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
  await cdp.send("Page.navigate", { url: `${BASE}/login` });
  await sleep(1000);
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

async function openCalendar(cdp, w) {
  await setViewport(cdp, w, 900);
  await cdp.send("Page.navigate", { url: `${BASE}/books/tax/calendar?view=all` });
  await waitFor(
    cdp,
    `(() => {
      const mobile = document.querySelector('.tax-cal-mobile');
      const desktop = document.querySelector('.tax-cal-desktop');
      const cards = document.querySelectorAll('.tax-cal-card');
      const rows = document.querySelectorAll('.tax-cal-table tbody tr');
      if (mobile && getComputedStyle(mobile).display !== 'none' && cards.length)
        return cards[0].innerText.length > 10;
      if (desktop && getComputedStyle(desktop).display !== 'none' && rows.length)
        return (rows[0].innerText || '').length > 5;
      return false;
    })()`,
  );
  await sleep(300);
}

async function measure(cdp, w) {
  const r = await cdp.send("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      const mobile = document.querySelector('.tax-cal-mobile');
      const desktop = document.querySelector('.tax-cal-desktop');
      const isMobile = mobile && getComputedStyle(mobile).display !== 'none';

      function lineBoxes(el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        return range.getClientRects().length;
      }
      function lineCount(el) {
        const cs = getComputedStyle(el);
        const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2 || 16;
        return Math.round(el.getBoundingClientRect().height / lh);
      }
      function isIsoDate(t) {
        return /^\\d{4}-\\d{2}-\\d{2}$/.test((t || '').trim());
      }

      const dateEls = isMobile
        ? [...document.querySelectorAll('.tax-cal-card-due')]
        : [
            ...document.querySelectorAll('td.tax-cal-due > div:first-child'),
            ...document.querySelectorAll('td.tax-cal-due .tax-cal-fileby-date'),
          ];

      const splitDates = dateEls
        .filter((el) => {
          const t = (el.innerText || '').trim();
          // ISO dates must be single line; "date to confirm" may wrap at spaces.
          if (!isIsoDate(t)) return false;
          return lineBoxes(el) > 1 || lineCount(el) > 1;
        })
        .map((el) => el.innerText.trim());

      const chipSel = isMobile
        ? '.tax-cal-card-chips .chip'
        : 'td.tax-cal-status .chip, td.tax-cal-applies .chip';
      const clippedChips = [...document.querySelectorAll(chipSel)]
        .filter((c) => c.scrollWidth > c.clientWidth + 1)
        .map((c) => ({
          text: c.innerText.trim(),
          scrollWidth: c.scrollWidth,
          clientWidth: c.clientWidth,
        }));

      let hasHScroll = false;
      let scrollWidth = null;
      let clientWidth = null;
      if (!isMobile && desktop) {
        scrollWidth = desktop.scrollWidth;
        clientWidth = desktop.clientWidth;
        hasHScroll = scrollWidth > clientWidth + 1;
      }

      return {
        iw: innerWidth,
        mode: isMobile ? 'phone' : 'desktop',
        dateCount: dateEls.length,
        splitDates,
        clippedChips,
        hasHScroll,
        scrollWidth,
        clientWidth,
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
  fs.rmSync(`/tmp/tax-cal-layout-guard`, { recursive: true, force: true });
  const chrome = spawn(
    CHROME,
    [
      `--remote-debugging-port=${PORT}`,
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      `--user-data-dir=/tmp/tax-cal-layout-guard`,
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
  await login(cdp);

  const report = [];
  let failed = false;
  for (const w of VIEWPORTS) {
    await openCalendar(cdp, w);
    const m = await measure(cdp, w);
    report.push(m);
    console.log(`viewport ${w}`, JSON.stringify(m));
    if (m.splitDates?.length) {
      console.error(`FAIL ${w}: split ISO dates:`, m.splitDates.join(", "));
      failed = true;
    }
    if (m.clippedChips?.length) {
      console.error(`FAIL ${w}: clipped chips:`, JSON.stringify(m.clippedChips));
      failed = true;
    }
    if (m.hasHScroll) {
      console.error(`FAIL ${w}: H-scroll ${m.scrollWidth}/${m.clientWidth}`);
      failed = true;
    }
  }

  cdp.close();
  chrome.kill("SIGKILL");
  if (failed) {
    console.error("TAX_CAL_LAYOUT_GUARD_FAIL");
    process.exit(1);
  }
  console.log("TAX_CAL_LAYOUT_GUARD_PASS");
  console.log(JSON.stringify({ viewports: report }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
