#!/usr/bin/env node
/**
 * Capture brand-06 before/after screenshots via Chrome CDP.
 * Usage: PHASE=before|after node scripts/brand-06-shots.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME = process.env.CHROME || "/usr/bin/google-chrome-stable";
const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PORT = Number(process.env.SHOT_CDP_PORT || 9422);
const PHASE = process.env.PHASE || "before";
const email = process.env.GUARD_EMAIL || "jerwin@example.com";
const password = process.env.GUARD_PASSWORD || process.env.SEED_PASSWORD || "TestPass123!";
const OUT = process.env.SHOT_OUT || `/opt/cursor/artifacts/brand-06-${PHASE}`;
const DOCS = process.env.SHOT_DOCS || `/workspace/docs/screenshots/brand-06/${PHASE}`;

const VIEWPORTS = [
  { w: 360, h: 800, tag: "360" },
  { w: 1280, h: 900, tag: "1280" },
];

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

async function setViewport(cdp, w, h) {
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

async function shot(cdp, name) {
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  const buf = Buffer.from(data, "base64");
  const a = path.join(OUT, name);
  const b = path.join(DOCS, name);
  fs.writeFileSync(a, buf);
  fs.writeFileSync(b, buf);
  console.log("wrote", name, buf.length);
}

async function login(cdp) {
  await setViewport(cdp, 1280, 900);
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

async function discoverIds(cdp) {
  // Prefer known seed ids when present; otherwise scrape list pages.
  const knownSo = process.env.SHOT_SO_PATH;
  const knownCust = process.env.SHOT_CUSTOMER_PATH;
  if (knownSo && knownCust) return { soPath: knownSo, customerPath: knownCust };

  await cdp.send("Page.navigate", { url: `${BASE}/sales-orders` });
  await waitFor(cdp, `document.readyState === 'complete'`);
  await sleep(500);
  const so = await cdp.send("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      const a = [...document.querySelectorAll('a[href]')].find((x) => /\\/sales-orders\\/[a-z0-9]+/i.test(x.getAttribute('href')||''));
      return a ? a.getAttribute('href') : null;
    })()`,
  });
  await cdp.send("Page.navigate", { url: `${BASE}/customers` });
  await waitFor(cdp, `document.readyState === 'complete'`);
  await sleep(500);
  const cust = await cdp.send("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      const a = [...document.querySelectorAll('a[href]')].find((x) => {
        const h = x.getAttribute('href') || '';
        return /\\/customers\\/[a-z0-9]+$/i.test(h) && !h.endsWith('/new');
      });
      return a ? a.getAttribute('href') : null;
    })()`,
  });
  return {
    soPath: so.result?.value || "/sales-orders",
    customerPath: cust.result?.value || "/customers",
  };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(DOCS, { recursive: true });
  const profile = `/tmp/brand-06-shots-${PHASE}`;
  fs.rmSync(profile, { recursive: true, force: true });
  fs.mkdirSync(profile, { recursive: true });

  const chrome = spawn(
    CHROME,
    [
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--window-size=1280,900",
      "about:blank",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
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
    throw new Error("Chrome CDP not ready");
  }
  const pageTarget = tabs.find((t) => t.type === "page") || tabs[0];
  const cdp = new Cdp(pageTarget.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");

  // Login page (logged out) — clear cookies first
  await cdp.send("Network.clearBrowserCookies");
  for (const vp of VIEWPORTS) {
    await setViewport(cdp, vp.w, vp.h);
    await cdp.send("Page.navigate", { url: `${BASE}/login` });
    await waitFor(cdp, `!!document.querySelector('input[name=email]')`);
    await sleep(400);
    await shot(cdp, `login-${vp.tag}.png`);
  }

  await login(cdp);
  const ids = await discoverIds(cdp);
  console.log("ids", ids);

  const pages = [
    { key: "home", path: "/" },
    { key: "customers-list", path: "/customers" },
    { key: "customer-detail", path: ids.customerPath },
    { key: "sales-order-cost-margin", path: `${ids.soPath}?tab=cost-margin` },
    { key: "billing", path: "/billing" },
    { key: "tax-calendar", path: "/books/tax/calendar?view=all" },
    { key: "settings", path: "/settings" },
  ];

  for (const page of pages) {
    for (const vp of VIEWPORTS) {
      await setViewport(cdp, vp.w, vp.h);
      await cdp.send("Page.navigate", { url: `${BASE}${page.path}` });
      await waitFor(
        cdp,
        `document.body && document.body.innerText && document.body.innerText.length > 40`,
      );
      await sleep(400);
      await shot(cdp, `${page.key}-${vp.tag}.png`);
    }
  }

  cdp.close();
  chrome.kill();
  console.log("done", PHASE);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
