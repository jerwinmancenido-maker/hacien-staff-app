#!/usr/bin/env node
/**
 * Quote Phase 1 screenshots: tabs × 1280/360, add-customer drawer, print preview.
 * Full-page shots at real height. Reports height and scrollWidth at 360.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { checkLocalSeedShots } from "./lib/assert-local-db.mjs";

const gate = checkLocalSeedShots(process.env);
if (!gate.ok) {
  console.error(gate.error);
  process.exit(1);
}

const CHROME = process.env.CHROME || "/usr/bin/google-chrome-stable";
// Prefer localhost over 127.0.0.1 so Next.js dev hydrates (allowedDevOrigins).
const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "").replace("://127.0.0.1", "://localhost");
const PORT = Number(process.env.SHOT_CDP_PORT || 9461);
const adminEmail = process.env.GUARD_EMAIL || "jerwin@example.com";
const password = process.env.GUARD_PASSWORD || process.env.SEED_PASSWORD || "TestPass123!";
const OUT = process.env.SHOT_OUT || "/opt/cursor/artifacts/quote-phase1-09";
const DOCS = process.env.SHOT_DOCS || "/workspace/docs/screenshots/quote-phase1-09";

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

async function waitFor(cdp, expression, timeoutMs = 45000) {
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

async function metrics(cdp) {
  const r = await cdp.send("Runtime.evaluate", {
    returnByValue: true,
    expression: `({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      scrollHeight: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0),
    })`,
  });
  return r.result?.value;
}

async function fullPageShot(cdp, name) {
  await cdp.send("Runtime.evaluate", { expression: `window.scrollTo(0,0)` });
  await sleep(200);
  const m = await metrics(cdp);
  const height = Math.max(m.scrollHeight || 900, 900);
  // Expand viewport to full page height for a true full-page capture.
  const w = (await metrics(cdp)).clientWidth || 1280;
  await setViewport(cdp, w, height);
  await sleep(250);
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: true });
  const buf = Buffer.from(data, "base64");
  for (const dir of [OUT, DOCS]) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), buf);
  }
  const after = await metrics(cdp);
  console.log(JSON.stringify({ name, height: after.scrollHeight, scrollWidth: after.scrollWidth, clientWidth: after.clientWidth, bytes: buf.length }));
  return after;
}

async function login(cdp, email) {
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

async function openQuoteEditor(cdp) {
  if (process.env.QUOTE_EDIT_PATH) {
    const path = process.env.QUOTE_EDIT_PATH;
    await cdp.send("Page.navigate", { url: `${BASE}${path}` });
    await waitFor(cdp, `!!document.querySelector('.quote-editor')`);
    await sleep(400);
    return path;
  }
  await cdp.send("Page.navigate", { url: `${BASE}/quotes?status=DRAFT` });
  await waitFor(cdp, `!!document.querySelector('a[href*=\"/quotes/\"]') || !!document.querySelector('.list')`);
  // Prefer a draft edit link; else open first quote then Edit.
  const href = await cdp.send("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      const edit = [...document.querySelectorAll('a[href*=\"/edit\"]')].map(a => a.getAttribute('href')).find(h => h && h.includes('/quotes/'));
      if (edit) return edit;
      const open = [...document.querySelectorAll('a[href^=\"/quotes/\"]')].map(a => a.getAttribute('href')).find(h => /^\\/quotes\\/[^/]+$/.test(h));
      return open || '/quotes/new';
    })()`,
  });
  let path = href.result?.value || "/quotes/new";
  if (path && !path.includes("/edit") && path !== "/quotes/new") {
    await cdp.send("Page.navigate", { url: `${BASE}${path}` });
    await sleep(600);
    const editHref = await cdp.send("Runtime.evaluate", {
      returnByValue: true,
      expression: `document.querySelector('a[href$=\"/edit\"]')?.getAttribute('href') || ''`,
    });
    path = editHref.result?.value || "/quotes/new";
  }
  await cdp.send("Page.navigate", { url: `${BASE}${path}` });
  await waitFor(cdp, `!!document.querySelector('.quote-editor')`);
  await sleep(400);
  return path;
}

async function clickTab(cdp, label) {
  const r = await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const tabs = [...document.querySelectorAll('.quote-tab')];
      const t = tabs.find(el => (el.textContent || '').includes(${JSON.stringify(label)}));
      if (!t) return false;
      const propsKey = Object.keys(t).find((k) => k.startsWith('__reactProps$'));
      const onClick = propsKey ? t[propsKey]?.onClick : null;
      if (typeof onClick === 'function') {
        onClick({ preventDefault() {}, stopPropagation() {}, target: t, currentTarget: t, type: 'click', bubbles: true });
      } else {
        t.click();
      }
      return true;
    })()`,
    returnByValue: true,
  });
  if (!r.result?.value) throw new Error("clickTab failed: " + label);
  await sleep(400);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(DOCS, { recursive: true });
  const report = [];

  const profile = "/tmp/quote-phase1-09-shots";
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
      "--window-size=1280,1600",
      "about:blank",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  let tabs;
  for (let i = 0; i < 60; i++) {
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

  await login(cdp, adminEmail);
  const editorPath = await openQuoteEditor(cdp);

  const tabShots = [
    ["Items", "items"],
    ["Terms", "terms"],
    ["Notes", "notes"],
    ["Sign-off", "signoff"],
  ];

  for (const width of [1280, 360]) {
    await setViewport(cdp, width, width === 360 ? 1200 : 900);
    await cdp.send("Page.navigate", { url: `${BASE}${editorPath}` });
    await waitFor(cdp, `!!document.querySelector('.quote-editor')`);
    await sleep(400);

    for (const [label, slug] of tabShots) {
      await clickTab(cdp, label);
      const name = `quote-${slug}-${width}.png`;
      const m = await fullPageShot(cdp, name);
      report.push({ name, width, height: m.scrollHeight, scrollWidth: m.scrollWidth });
    }

    // Add-customer dialog on Items tab
    await clickTab(cdp, "Items");
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const sel = document.querySelector('#customerId');
        if (!sel) return false;
        const d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
        d.set.call(sel, '__add__');
        const propsKey = Object.keys(sel).find((k) => k.startsWith('__reactProps$'));
        const onChange = propsKey ? sel[propsKey]?.onChange : null;
        if (typeof onChange === 'function') {
          onChange({ target: sel, currentTarget: sel, type: 'change', bubbles: true, preventDefault() {}, stopPropagation() {} });
        } else {
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return true;
      })()`,
      returnByValue: true,
    });
    await waitFor(cdp, `!!document.querySelector('.quote-drawer')`);
    await sleep(300);
    const addName = `quote-add-customer-${width}.png`;
    const am = await fullPageShot(cdp, addName);
    report.push({ name: addName, width, height: am.scrollHeight, scrollWidth: am.scrollWidth });
    // Close drawer
    await cdp.send("Runtime.evaluate", {
      expression: `document.querySelector('.quote-drawer-x')?.click()`,
    });
    await sleep(200);
  }

  // Print preview: customer notes present, internal notes absent
  const quoteId = editorPath.split("/")[2];
  if (quoteId && quoteId !== "new") {
    await setViewport(cdp, 1280, 1600);
    await cdp.send("Page.navigate", { url: `${BASE}/print/quotes/${quoteId}` });
    await waitFor(cdp, `!!document.querySelector('.pp-doc, .print-doc, article')`);
    await sleep(500);
    const printCheck = await cdp.send("Runtime.evaluate", {
      returnByValue: true,
      expression: `(() => {
        const t = document.body.innerText || '';
        return {
          hasCustomerNote: t.includes('Customer note for print') || t.includes('Notes:'),
          hasInternal: t.includes('INTERNAL ONLY') || t.includes('Never print this'),
        };
      })()`,
    });
    console.log("printCheck", JSON.stringify(printCheck.result?.value));
    const pm = await fullPageShot(cdp, "quote-print-preview-1280.png");
    report.push({
      name: "quote-print-preview-1280.png",
      width: 1280,
      height: pm.scrollHeight,
      scrollWidth: pm.scrollWidth,
      printCheck: printCheck.result?.value,
    });
  }

  fs.writeFileSync(path.join(DOCS, "shot-report.json"), JSON.stringify({ host: gate.host, report }, null, 2));
  fs.writeFileSync(path.join(OUT, "shot-report.json"), JSON.stringify({ host: gate.host, report }, null, 2));

  cdp.close();
  chrome.kill("SIGKILL");
  console.log("shots done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
