#!/usr/bin/env node
/**
 * Capture Home + Non-VAT sidebar meter shots after PR 20 merge,
 * and assert the meter "of …" text fits (no horizontal overflow) at 1280/1024/360.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME = process.env.CHROME || "/usr/bin/google-chrome-stable";
const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PORT = Number(process.env.SHOT_CDP_PORT || 9433);
const email = process.env.GUARD_EMAIL || "jerwin@example.com";
const password = process.env.GUARD_PASSWORD || process.env.SEED_PASSWORD || "TestPass123!";
const OUT = process.env.SHOT_OUT || "/opt/cursor/artifacts/brand-06-home-meter";
const DOCS = process.env.SHOT_DOCS || "/workspace/docs/screenshots/brand-06";

const VIEWPORTS = [
  { w: 1280, h: 1200, tag: "1280" },
  { w: 1024, h: 1200, tag: "1024" },
  { w: 360, h: 1400, tag: "360" },
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

async function shot(cdp, name, clip) {
  const params = { format: "png", fromSurface: true };
  if (clip) params.clip = { ...clip, scale: 1 };
  const { data } = await cdp.send("Page.captureScreenshot", params);
  const buf = Buffer.from(data, "base64");
  for (const dir of [OUT, DOCS]) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), buf);
  }
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

async function meterFit(cdp) {
  const r = await cdp.send("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      const card = document.querySelector('a.tracker-card');
      if (!card) return { ok: false, reason: 'no tracker-card' };
      const value = card.querySelector('.value');
      const of = card.querySelector('.tracker-of');
      const cardBox = card.getBoundingClientRect();
      const valueBox = value?.getBoundingClientRect();
      const overflow =
        card.scrollWidth > card.clientWidth + 1 ||
        (value && value.scrollWidth > value.clientWidth + 1);
      return {
        ok: !overflow,
        text: value?.innerText || '',
        ofText: of?.innerText || '',
        cardW: Math.round(cardBox.width),
        valueW: valueBox ? Math.round(valueBox.width) : null,
        scrollW: card.scrollWidth,
        clientW: card.clientWidth,
        valueScrollW: value?.scrollWidth ?? null,
        valueClientW: value?.clientWidth ?? null,
      };
    })()`,
  });
  return r.result?.value;
}

async function meterClip(cdp) {
  const r = await cdp.send("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      const card = document.querySelector('a.tracker-card');
      if (!card) return null;
      const b = card.getBoundingClientRect();
      const pad = 8;
      return {
        x: Math.max(0, b.x - pad),
        y: Math.max(0, b.y - pad),
        width: Math.min(window.innerWidth, b.width + pad * 2),
        height: Math.min(window.innerHeight, b.height + pad * 2),
      };
    })()`,
  });
  return r.result?.value;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(DOCS, { recursive: true });
  const profile = "/tmp/brand-06-home-meter";
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

  await login(cdp);

  const fits = [];
  for (const vp of VIEWPORTS) {
    await setViewport(cdp, vp.w, vp.h);
    await cdp.send("Page.navigate", { url: `${BASE}/` });
    await waitFor(cdp, `!!document.querySelector('a.tracker-card')`);
    await cdp.send("Runtime.evaluate", {
      expression: `document.querySelector('a.tracker-card')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })`,
    });
    await sleep(500);

    const fit = await meterFit(cdp);
    console.log("fit", vp.tag, JSON.stringify(fit));
    fits.push({ tag: vp.tag, ...fit });
    if (!fit?.ok) throw new Error(`Non-VAT meter overflows at ${vp.tag}: ${JSON.stringify(fit)}`);

    // Full Home page at 1280 and 360 (requested); also keep 1024 for the fit check only.
    if (vp.tag === "1280" || vp.tag === "360") {
      await cdp.send("Runtime.evaluate", {
        expression: `window.scrollTo(0, 0); document.querySelector('a.tracker-card')?.scrollIntoView({ block: 'nearest' })`,
      });
      await sleep(200);
      await shot(cdp, `home-after-pr20-merge-${vp.tag}.png`);
      const clip = await meterClip(cdp);
      if (!clip || clip.width < 40 || clip.height < 40) {
        throw new Error(`Bad meter clip at ${vp.tag}: ${JSON.stringify(clip)}`);
      }
      await shot(cdp, `sidebar-nonvat-meter-${vp.tag}.png`, clip);
    }
  }

  cdp.close();
  chrome.kill();
  console.log("done", fits);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
