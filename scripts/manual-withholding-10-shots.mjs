#!/usr/bin/env node
/**
 * Manual withholding (brief 10) screenshots: quote editor, customer page,
 * add-customer drawer, print preview — each at 1280 and 360/390.
 * Line chips at 1280 + 390 (goods: WHT 1% WI640 + WHT 3% WB080; services: WHT 3% WB080).
 * Print preview also at 390 — scrollWidth must be ≤ 390 (no h-scroll).
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
const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "").replace("://127.0.0.1", "://localhost");
const PORT = Number(process.env.SHOT_CDP_PORT || 9471);
const adminEmail = process.env.GUARD_EMAIL || "jerwin@example.com";
const password = process.env.GUARD_PASSWORD || process.env.SEED_PASSWORD || "TestPass123!";
const OUT = process.env.SHOT_OUT || "/opt/cursor/artifacts/manual-withholding-10";
const DOCS = process.env.SHOT_DOCS || "/workspace/docs/screenshots/manual-withholding-10";

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
    const p = process.env.QUOTE_EDIT_PATH;
    await cdp.send("Page.navigate", { url: `${BASE}${p}` });
    await waitFor(cdp, `!!document.querySelector('.quote-editor')`);
    await sleep(400);
    return p;
  }
  await cdp.send("Page.navigate", { url: `${BASE}/quotes?status=DRAFT` });
  await waitFor(cdp, `!!document.querySelector('a[href*=\"/quotes/\"]') || !!document.querySelector('.list')`);
  const href = await cdp.send("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      const edit = [...document.querySelectorAll('a[href*=\"/edit\"]')].map(a => a.getAttribute('href')).find(h => h && h.includes('/quotes/'));
      if (edit) return edit;
      const open = [...document.querySelectorAll('a[href^=\"/quotes/\"]')].map(a => a.getAttribute('href')).find(h => /^\\/quotes\\/[^/]+$/.test(h));
      return open || '/quotes/new';
    })()`,
  });
  let p = href.result?.value || "/quotes/new";
  if (p && !p.includes("/edit") && p !== "/quotes/new") {
    await cdp.send("Page.navigate", { url: `${BASE}${p}` });
    await sleep(600);
    const editHref = await cdp.send("Runtime.evaluate", {
      returnByValue: true,
      expression: `document.querySelector('a[href$=\"/edit\"]')?.getAttribute('href') || ''`,
    });
    p = editHref.result?.value || "/quotes/new";
  }
  await cdp.send("Page.navigate", { url: `${BASE}${p}` });
  await waitFor(cdp, `!!document.querySelector('.quote-editor')`);
  await sleep(400);
  return p;
}

async function openAddCustomerDrawer(cdp) {
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
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(DOCS, { recursive: true });
  const report = [];

  const profile = "/tmp/manual-withholding-10-shots";
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
  const quoteId = editorPath.split("/")[2];

  // Resolve government customer id from the editor page (or env).
  const customerId = await cdp.send("Runtime.evaluate", {
    returnByValue: true,
    expression: `document.querySelector('#customerId')?.value || ''`,
  });
  const custId = process.env.CUSTOMER_ID || customerId.result?.value || "";

  for (const width of [1280, 360]) {
    await setViewport(cdp, width, width === 360 ? 1200 : 900);

    // Quote editor — Items (pick hint + withholding field + internal panel)
    await cdp.send("Page.navigate", { url: `${BASE}${editorPath}` });
    await waitFor(cdp, `!!document.querySelector('.quote-editor')`);
    await sleep(500);
    // Re-apply so stacked lines get null ATC and chips render (never "4% WI640").
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const btn = [...document.querySelectorAll('button')].find((el) => /Re-apply customer's withholding/i.test(el.textContent || ''));
        if (!btn) return false;
        const propsKey = Object.keys(btn).find((k) => k.startsWith('__reactProps$'));
        const onClick = propsKey ? btn[propsKey]?.onClick : null;
        if (typeof onClick === 'function') {
          onClick({ preventDefault() {}, stopPropagation() {}, target: btn, currentTarget: btn, type: 'click', bubbles: true });
        } else {
          btn.click();
        }
        return true;
      })()`,
      returnByValue: true,
    });
    await sleep(400);
    // Scroll internal panel into view briefly then full-page shot
    await cdp.send("Runtime.evaluate", {
      expression: `document.querySelector('.wh-internal-panel, .wh-pick, [class*=\"wh-\"]')?.scrollIntoView({block:'center'})`,
    });
    await sleep(200);
    let m = await fullPageShot(cdp, `quote-editor-pick-${width}.png`);
    report.push({ name: `quote-editor-pick-${width}.png`, width, height: m.scrollHeight, scrollWidth: m.scrollWidth });

    // Expand pick (Change), then Reset → "not set" notice (same draft; restore later for print)
    async function clickLabeled(labelRe) {
      const r = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const re = ${labelRe};
          const btn = [...document.querySelectorAll('button,a')].find((el) => re.test((el.textContent || '').trim()));
          if (!btn) return false;
          const propsKey = Object.keys(btn).find((k) => k.startsWith('__reactProps$'));
          const onClick = propsKey ? btn[propsKey]?.onClick : null;
          if (typeof onClick === 'function') {
            onClick({ preventDefault() {}, stopPropagation() {}, target: btn, currentTarget: btn, type: 'click', bubbles: true });
          } else {
            btn.click();
          }
          return true;
        })()`,
        returnByValue: true,
      });
      return r.result?.value;
    }
    await clickLabeled("/^Change$/i");
    await sleep(250);
    await clickLabeled("/^Reset$/i");
    await waitFor(
      cdp,
      `(document.body.innerText || '').includes('Withholding not set for this customer') || (document.body.innerText || '').includes('Withholding: not set')`,
    );
    await sleep(300);
    m = await fullPageShot(cdp, `quote-editor-not-set-${width}.png`);
    report.push({ name: `quote-editor-not-set-${width}.png`, width, height: m.scrollHeight, scrollWidth: m.scrollWidth });

    // Submit confirm when pick is not set
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const btn = [...document.querySelectorAll('button')].find((el) => /Submit for approval/i.test(el.textContent || ''));
        if (!btn) return false;
        const propsKey = Object.keys(btn).find((k) => k.startsWith('__reactProps$'));
        const onClick = propsKey ? btn[propsKey]?.onClick : null;
        if (typeof onClick === 'function') {
          onClick({ preventDefault() {}, stopPropagation() {}, target: btn, currentTarget: btn, type: 'click', bubbles: true });
        } else {
          btn.click();
        }
        return true;
      })()`,
      returnByValue: true,
    });
    await waitFor(cdp, `(document.body.innerText || '').includes('No withholding on this quote')`);
    await sleep(250);
    m = await fullPageShot(cdp, `quote-submit-confirm-none-${width}.png`);
    report.push({ name: `quote-submit-confirm-none-${width}.png`, width, height: m.scrollHeight, scrollWidth: m.scrollWidth });
    // Dismiss confirm (Pick rates) so we don't mark the quote sent
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const btn = [...document.querySelectorAll('button')].find((el) => /Pick rates/i.test(el.textContent || ''));
        if (!btn) return false;
        const propsKey = Object.keys(btn).find((k) => k.startsWith('__reactProps$'));
        const onClick = propsKey ? btn[propsKey]?.onClick : null;
        if (typeof onClick === 'function') {
          onClick({ preventDefault() {}, stopPropagation() {}, target: btn, currentTarget: btn, type: 'click', bubbles: true });
        } else {
          btn.click();
        }
        return true;
      })()`,
      returnByValue: true,
    });
    await sleep(200);

    // Restore combined pick (Goods 1% + Gov 3%) for remaining shots / print
    await cdp.send("Page.navigate", { url: `${BASE}${editorPath}` });
    await waitFor(cdp, `!!document.querySelector('.quote-editor')`);
    await sleep(400);

    // Add-customer drawer with Withholding pick field
    await openAddCustomerDrawer(cdp);
    m = await fullPageShot(cdp, `quote-add-customer-pick-${width}.png`);
    report.push({ name: `quote-add-customer-pick-${width}.png`, width, height: m.scrollHeight, scrollWidth: m.scrollWidth });
    await cdp.send("Runtime.evaluate", {
      expression: `document.querySelector('.quote-drawer-x')?.click()`,
    });
    await sleep(200);

    // Customer overview — pick chip (not "No withholding" while rates apply)
    if (custId) {
      await cdp.send("Page.navigate", { url: `${BASE}/customers/${custId}` });
      await waitFor(cdp, `!!document.querySelector('.overview-dashboard, .overview-profile-card, h2')`);
      await sleep(400);
      m = await fullPageShot(cdp, `customer-overview-pick-${width}.png`);
      report.push({ name: `customer-overview-pick-${width}.png`, width, height: m.scrollHeight, scrollWidth: m.scrollWidth });

      // Customer Details — Yes (Government) shows pick boxes
      await cdp.send("Page.navigate", { url: `${BASE}/customers/${custId}?tab=details` });
      await waitFor(cdp, `!!document.querySelector('#withholdingType, form')`);
      await sleep(400);
      // Ensure type is Yes / Government
      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const sel = document.querySelector('#withholdingType');
          if (!sel) return false;
          const d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
          d.set.call(sel, 'GOVERNMENT');
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
      await sleep(300);
      await waitFor(cdp, `!!document.querySelector('.wh-pick-list, .wh-pick-row')`);
      m = await fullPageShot(cdp, `customer-edit-yes-${width}.png`);
      report.push({ name: `customer-edit-yes-${width}.png`, width, height: m.scrollHeight, scrollWidth: m.scrollWidth });

      // Switch to No → boxes hidden
      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const sel = document.querySelector('#withholdingType');
          if (!sel) return false;
          const d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
          d.set.call(sel, 'NONE');
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
      await sleep(300);
      m = await fullPageShot(cdp, `customer-edit-no-${width}.png`);
      report.push({ name: `customer-edit-no-${width}.png`, width, height: m.scrollHeight, scrollWidth: m.scrollWidth });
    }
  }

  // Dedicated chip shots at 1280 + 390 (goods stacked chips + services WB080 chip).
  for (const width of [1280, 390]) {
    await setViewport(cdp, width, width === 390 ? 1400 : 900);
    await cdp.send("Page.navigate", { url: `${BASE}${editorPath}` });
    await waitFor(cdp, `!!document.querySelector('.quote-editor')`);
    await sleep(500);
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const btn = [...document.querySelectorAll('button')].find((el) => /Re-apply customer's withholding/i.test(el.textContent || ''));
        if (!btn) return false;
        const propsKey = Object.keys(btn).find((k) => k.startsWith('__reactProps$'));
        const onClick = propsKey ? btn[propsKey]?.onClick : null;
        if (typeof onClick === 'function') {
          onClick({ preventDefault() {}, stopPropagation() {}, target: btn, currentTarget: btn, type: 'click', bubbles: true });
        } else {
          btn.click();
        }
        return true;
      })()`,
      returnByValue: true,
    });
    await sleep(400);
    const chipCheck = await cdp.send("Runtime.evaluate", {
      returnByValue: true,
      expression: `(() => {
        const chips = [...document.querySelectorAll('.quote-tg-wh.is-chip')].map((el) => (el.textContent || '').trim());
        const labels = [...document.querySelectorAll('[aria-label*="WHT"]')].map((el) => el.getAttribute('aria-label') || '');
        return {
          chips,
          labels,
          hasCombined4Wi640: chips.some((t) => /WHT\\s*4%\\s*WI640/i.test(t)) || labels.some((t) => /WHT\\s*4%\\s*WI640/i.test(t)),
          hasGoods1: chips.includes('WHT 1% WI640'),
          hasGoods3: chips.includes('WHT 3% WB080'),
          hasServicesOnly3: chips.filter((t) => t === 'WHT 3% WB080').length >= 1,
        };
      })()`,
    });
    console.log("chipCheck", width, JSON.stringify(chipCheck.result?.value));
    await cdp.send("Runtime.evaluate", {
      expression: `document.querySelector('.quote-ln-tags, .quote-line-card-wh-chips, .quote-items-desktop, .quote-items-mobile')?.scrollIntoView({block:'center'})`,
    });
    await sleep(200);
    const cm = await fullPageShot(cdp, `quote-line-chips-${width}.png`);
    if (chipCheck.result?.value?.hasCombined4Wi640) {
      throw new Error(`Combined 4% WI640 chip found at ${width} — stacked lines must show one chip per ATC`);
    }
    report.push({
      name: `quote-line-chips-${width}.png`,
      width,
      height: cm.scrollHeight,
      scrollWidth: cm.scrollWidth,
      chipCheck: chipCheck.result?.value,
    });
  }

  // Print preview: Subtotal + Total only — no withholding / WHT / ATC
  if (quoteId && quoteId !== "new") {
    await setViewport(cdp, 1280, 1600);
    await cdp.send("Page.navigate", { url: `${BASE}/print/quotes/${quoteId}` });
    await waitFor(cdp, `!!document.querySelector('.pp-doc, .print-doc, article, .pp-page')`);
    await sleep(500);
    const printCheck = await cdp.send("Runtime.evaluate", {
      returnByValue: true,
      expression: `(() => {
        const t = (document.body.innerText || '').toLowerCase();
        return {
          hasWithholding: t.includes('withholding'),
          hasWht: t.includes('wht'),
          hasAtc: /\\batc\\b/.test(t),
          hasNetDue: t.includes('net amount due'),
          hasSubtotal: t.includes('subtotal'),
          hasTotal: t.includes('total'),
          hasInternal: t.includes('internal only'),
        };
      })()`,
    });
    console.log("printCheck", JSON.stringify(printCheck.result?.value));
    const pm = await fullPageShot(cdp, "quote-print-no-withholding-1280.png");
    report.push({
      name: "quote-print-no-withholding-1280.png",
      width: 1280,
      height: pm.scrollHeight,
      scrollWidth: pm.scrollWidth,
      printCheck: printCheck.result?.value,
    });

    // Phone print preview at 390 — must have no horizontal scroll (was ~794 from 210mm).
    await setViewport(cdp, 390, 844);
    await cdp.send("Page.navigate", { url: `${BASE}/print/quotes/${quoteId}` });
    await waitFor(cdp, `!!document.querySelector('.pp-doc, .print-doc, article, .pp-page')`);
    await sleep(600);
    const phoneMeasure = await cdp.send("Runtime.evaluate", {
      returnByValue: true,
      expression: `(() => {
        const de = document.documentElement;
        const page = document.querySelector('.pp-page');
        return {
          scrollWidth: Math.max(de.scrollWidth || 0, document.body?.scrollWidth || 0),
          clientWidth: de.clientWidth,
          pageWidth: page ? Math.ceil(page.getBoundingClientRect().width) : 0,
        };
      })()`,
    });
    const pm390 = phoneMeasure.result?.value;
    console.log("print390Measure", JSON.stringify(pm390));
    if (!pm390 || pm390.scrollWidth > 390) {
      throw new Error(`Print preview h-scroll at 390: scrollWidth=${pm390?.scrollWidth} (must be ≤ 390)`);
    }
    const pmPhone = await fullPageShot(cdp, "quote-print-preview-390.png");
    if (pmPhone.scrollWidth > 390) {
      throw new Error(`Print preview full-page h-scroll at 390: scrollWidth=${pmPhone.scrollWidth}`);
    }
    report.push({
      name: "quote-print-preview-390.png",
      width: 390,
      height: pmPhone.scrollHeight,
      scrollWidth: pmPhone.scrollWidth,
      print390Measure: pm390,
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
