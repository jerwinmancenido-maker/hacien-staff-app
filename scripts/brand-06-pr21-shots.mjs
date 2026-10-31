#!/usr/bin/env node
/**
 * Post PR-21 merge shots: Home + Payables at 360/1280, plus Payables 360 with 2307 on
 * (temporary — proves tab scroll fade/arrows with 4 tabs). Default flag stays OFF.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME = process.env.CHROME || "/usr/bin/google-chrome-stable";
const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PORT = Number(process.env.SHOT_CDP_PORT || 9455);
const email = process.env.GUARD_EMAIL || "jerwin@example.com";
const password = process.env.GUARD_PASSWORD || process.env.SEED_PASSWORD || "TestPass123!";
const OUT = process.env.SHOT_OUT || "/opt/cursor/artifacts/brand-06-pr21";
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
  const profile = "/tmp/brand-06-pr21-shots";
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
    { w: 1280, h: 1200, tag: "1280" },
    { w: 360, h: 900, tag: "360" },
  ]) {
    await setViewport(cdp, vp.w, vp.h);
    await cdp.send("Page.navigate", { url: `${BASE}/` });
    await waitFor(cdp, `!!document.querySelector('.home-dashboard, .home-section, .page-header')`);
    await sleep(400);
    const search = await evalJson(
      cdp,
      `(() => {
        const toggle = document.querySelector('.topbar-search-toggle');
        const field = document.querySelector('.topbar-search-wrap .topbar-search');
        const toggleVis = toggle && getComputedStyle(toggle).display !== 'none';
        const fieldVis = field && getComputedStyle(field).display !== 'none';
        return { toggleVis, fieldVis, clipped: fieldVis && field && field.scrollWidth > field.clientWidth + 1 };
      })()`,
    );
    console.log("home-search", vp.tag, JSON.stringify(search));
    if (vp.tag === "360" && !search?.toggleVis) throw new Error("search should be icon at 360");
    if (vp.tag === "360" && search?.fieldVis) throw new Error("search field should be hidden until opened at 360");
    await shot(cdp, `home-after-pr21-${vp.tag}.png`);

    await cdp.send("Page.navigate", { url: `${BASE}/payables` });
    await waitFor(cdp, `document.body.innerText.includes('Payables')`);
    await sleep(500);
    const pay = await evalJson(
      cdp,
      `(() => {
        const labels = [...document.querySelectorAll('.pill-tab')].map((t) =>
          (t.querySelector('.pill-tab-label')?.textContent || '').trim(),
        );
        const actions = document.querySelector('.empty-actions');
        const gap = actions ? getComputedStyle(actions).gap : null;
        const has2307 = /2307 to issue|EWT pending certificate/i.test(document.body.innerText);
        return { labels, gap, has2307, path: location.pathname };
      })()`,
    );
    console.log("payables", vp.tag, JSON.stringify(pay));
    if (pay?.path !== "/payables") throw new Error("Payables not reachable");
    if (pay?.has2307) throw new Error("2307 should be off by default");
    if (pay?.gap && pay.gap !== "10px") console.warn("unexpected empty-actions gap", pay.gap);
    await shot(cdp, `payables-after-pr21-${vp.tag}.png`);
  }

  cdp.close();
  chrome.kill();
  console.log("done default shots");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
