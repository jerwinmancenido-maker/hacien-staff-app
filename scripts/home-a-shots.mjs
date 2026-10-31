#!/usr/bin/env node
/**
 * Concept A Home screenshots: data / empty / staff × 1280 / 360.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME = process.env.CHROME || "/usr/bin/google-chrome-stable";
const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PORT = Number(process.env.SHOT_CDP_PORT || 9451);
const adminEmail = process.env.GUARD_EMAIL || "jerwin@example.com";
const staffEmail = process.env.STAFF_EMAIL || "staff@example.com";
const password = process.env.GUARD_PASSWORD || process.env.SEED_PASSWORD || "TestPass123!";
const OUT = process.env.SHOT_OUT || "/opt/cursor/artifacts/home-sales-07";
const DOCS = process.env.SHOT_DOCS || "/workspace/docs/screenshots/home-sales-07";

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

async function goHome(cdp, w, h) {
  await setViewport(cdp, w, h);
  await cdp.send("Page.navigate", { url: `${BASE}/` });
  await waitFor(cdp, `!!document.querySelector('.home-dashboard, .home-getting-started')`);
  await sleep(500);
}

async function shotHome(cdp, name, w, h, readyExpr) {
  await goHome(cdp, w, h);
  if (readyExpr) await waitFor(cdp, readyExpr);
  await cdp.send("Runtime.evaluate", {
    expression: `window.scrollTo(0, 0); document.querySelector('.page-header, .home-dashboard')?.scrollIntoView({ block: 'start' });`,
  });
  await sleep(350);
  await shot(cdp, name);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(DOCS, { recursive: true });
  const profile = "/tmp/home-a-shots";
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

  const mode = process.argv[2] || "data";

  if (mode === "staff") {
    await login(cdp, staffEmail);
    await shotHome(cdp, "home-a-staff-1280.png", 1280, 1400, `!!document.querySelector('.home-dashboard.is-staff, .home-na-card')`);
    await shotHome(cdp, "home-a-staff-360.png", 360, 1800, `!!document.querySelector('.home-dashboard.is-staff, .home-na-card')`);
  } else if (mode === "empty") {
    await login(cdp, adminEmail);
    await shotHome(cdp, "home-a-empty-1280.png", 1280, 1400, `!!document.querySelector('.home-sales.is-empty, .home-sales-empty, .home-sales')`);
    await shotHome(cdp, "home-a-empty-360.png", 360, 1800, `!!document.querySelector('.home-sales.is-empty, .home-sales-empty, .home-sales')`);
  } else {
    await login(cdp, adminEmail);
    await shotHome(cdp, "home-a-data-1280.png", 1280, 1600, `!!document.querySelector('.home-sales') && !!document.querySelector('.home-kps')`);
    await shotHome(cdp, "home-a-data-360.png", 360, 2000, `!!document.querySelector('.home-sales') && !!document.querySelector('.home-kps')`);
  }

  cdp.close();
  chrome.kill("SIGKILL");
  console.log("shots done:", mode);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
