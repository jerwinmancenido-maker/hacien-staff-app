#!/usr/bin/env node
/**
 * Reviewer-nits shots: Home, Payments empty, avatar menu closed/open at 1280 + 360.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME = process.env.CHROME || "/usr/bin/google-chrome-stable";
const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PORT = Number(process.env.SHOT_CDP_PORT || 9460);
const email = process.env.GUARD_EMAIL || "jerwin@example.com";
const password = process.env.GUARD_PASSWORD || process.env.SEED_PASSWORD || "TestPass123!";
const OUT = process.env.SHOT_OUT || "/opt/cursor/artifacts/brand-06-nits";
const DOCS = process.env.SHOT_DOCS || "/workspace/docs/screenshots/brand-06";

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
  for (const dir of [OUT, DOCS]) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), buf);
  }
  console.log("wrote", name, buf.length);
}

async function evalJson(cdp, expression) {
  const r = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return r.result?.value;
}

async function login(cdp) {
  await setViewport(cdp, 1280, 900);
  await cdp.send("Page.navigate", { url: `${BASE}/login` });
  await sleep(800);
  const state = await evalJson(cdp, `({ hasEmail: !!document.querySelector('input[name=email]') })`);
  if (state?.hasEmail) {
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

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(DOCS, { recursive: true });
  const profile = "/tmp/brand-06-nits-shots";
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
      "--window-size=1280,1200",
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

  await login(cdp);

  for (const vp of [
    { w: 1280, h: 900, tag: "1280" },
    { w: 360, h: 800, tag: "360" },
  ]) {
    // Home
    await setViewport(cdp, vp.w, vp.h);
    await cdp.send("Page.navigate", { url: `${BASE}/` });
    await waitFor(cdp, `!!document.querySelector('.account-menu-trigger')`);
    await sleep(350);
    await shot(cdp, `home-${vp.tag}.png`);

    // Avatar menu closed + open
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const t = document.querySelector('.account-menu-trigger');
        if (t?.getAttribute('aria-expanded') === 'true') t.click();
        return true;
      })()`,
    });
    await sleep(150);
    await shot(cdp, `avatar-menu-closed-${vp.tag}.png`);
    await cdp.send("Runtime.evaluate", {
      expression: `document.querySelector('.account-menu-trigger')?.click()`,
    });
    await waitFor(cdp, `!!document.querySelector('.account-menu-panel')`);
    await sleep(150);
    await shot(cdp, `avatar-menu-open-${vp.tag}.png`);
    await cdp.send("Runtime.evaluate", {
      expression: `document.querySelector('.account-menu-trigger')?.click()`,
    });

    // Payments empty
    await cdp.send("Page.navigate", { url: `${BASE}/payables/payments` });
    await waitFor(cdp, `document.body.innerText.includes('No payments recorded yet') || document.querySelector('table.list')`);
    await sleep(400);
    const payCheck = await evalJson(
      cdp,
      `(() => {
        const empty = document.querySelector('.payments-empty, .empty');
        const emptyText = empty?.innerText || '';
        const tableInEmpty = !!document.querySelector('.payments-empty table, .empty table');
        const sw = document.documentElement.scrollWidth;
        const cw = document.documentElement.clientWidth;
        const overflow = sw > cw + 1;
        const clippedBtn = [...document.querySelectorAll('.payments-empty .btn, .empty .btn')].some((b) => b.scrollWidth > b.clientWidth + 1);
        return {
          path: location.pathname,
          emptyText: emptyText.slice(0, 80),
          tableInEmpty,
          overflow,
          scrollWidth: sw,
          clientWidth: cw,
          clippedBtn,
        };
      })()`,
    );
    console.log("payments", vp.tag, JSON.stringify(payCheck));
    if (vp.tag === "360" && payCheck.overflow) {
      throw new Error(`Payments page horizontal overflow at 360: ${payCheck.scrollWidth}>${payCheck.clientWidth}`);
    }
    if (payCheck.tableInEmpty) throw new Error("empty state still uses a table");
    if (payCheck.clippedBtn) throw new Error("empty CTA text clipped");
    await shot(cdp, `payments-empty-${vp.tag}.png`);
  }

  cdp.close();
  chrome.kill();
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
