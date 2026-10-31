#!/usr/bin/env node
/**
 * Full-page Settings tab screenshots for Brief 08 (local throwaway DB only).
 *
 *   ALLOW_SEED_SHOTS=1 node scripts/settings-layout-08-shots.mjs
 *
 * Writes docs/screenshots/settings-layout-08/<tab>-1280.png and <tab>-360.png.
 * Never prints secrets. Uses seed user jerwin@example.com only.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { assertLocalSeedShotsOrExit } from "./lib/assert-local-db.mjs";

assertLocalSeedShotsOrExit();

const CHROME = process.env.CHROME || "/usr/bin/google-chrome-stable";
const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PORT = Number(process.env.SHOT_CDP_PORT || 9480);
const email = process.env.GUARD_EMAIL || "jerwin@example.com";
const password = process.env.GUARD_PASSWORD || process.env.SEED_PASSWORD || "TestPass123!";
const DOCS = process.env.SHOT_DOCS || "/workspace/docs/screenshots/settings-layout-08";
const OUT = process.env.SHOT_OUT || "/opt/cursor/artifacts/settings-layout-08";

const TABS = [
  "users",
  "approval",
  "numbering",
  "tax",
  "tax-calendar",
  "withholding",
  "billing",
  "features",
  "print",
  "lists",
  "changelog",
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

async function login(cdp) {
  await setViewport(cdp, 1280, 900);
  await cdp.send("Page.navigate", { url: `${BASE}/login` });
  await waitFor(cdp, `!!document.querySelector('input[name=email]')`);
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

async function captureTab(cdp, tab, width) {
  const url = `${BASE}/settings?tab=${tab}`;
  await cdp.send("Page.navigate", { url });
  await waitFor(cdp, `document.readyState === 'complete'`);
  await waitFor(
    cdp,
    `!!document.querySelector('.settings-page, .pill-tabs-wrap') && !document.querySelector('input[name=email]')`,
  );
  await sleep(400);

  // Measure real page height + scrollWidth, then resize viewport to full page height.
  const metrics = await cdp.send("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      const de = document.documentElement;
      const body = document.body;
      const height = Math.max(
        de.scrollHeight, body.scrollHeight,
        de.offsetHeight, body.offsetHeight,
        de.clientHeight
      );
      const scrollWidth = Math.max(de.scrollWidth, body.scrollWidth);
      return { height, scrollWidth, clientWidth: de.clientWidth };
    })()`,
  });
  const { height, scrollWidth, clientWidth } = metrics.result.value;
  const pageH = Math.max(height, 600);
  await setViewport(cdp, width, pageH);
  await sleep(200);

  // Re-measure after viewport change (layout may reflow).
  const metrics2 = await cdp.send("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      const de = document.documentElement;
      const body = document.body;
      const height = Math.max(
        de.scrollHeight, body.scrollHeight,
        de.offsetHeight, body.offsetHeight,
        de.clientHeight
      );
      const scrollWidth = Math.max(de.scrollWidth, body.scrollWidth);
      return { height, scrollWidth, clientWidth: de.clientWidth };
    })()`,
  });
  const h2 = Math.max(metrics2.result.value.height, pageH);
  const sw2 = metrics2.result.value.scrollWidth;
  if (h2 !== pageH) {
    await setViewport(cdp, width, h2);
    await sleep(150);
  }

  const name = `${tab}-${width}.png`;
  const { data } = await cdp.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  const buf = Buffer.from(data, "base64");
  fs.writeFileSync(path.join(OUT, name), buf);
  fs.writeFileSync(path.join(DOCS, name), buf);
  console.log(
    JSON.stringify({
      file: name,
      width,
      height: h2,
      scrollWidth: sw2,
      clientWidth: metrics2.result.value.clientWidth ?? clientWidth,
      firstPassHeight: height,
      firstPassScrollWidth: scrollWidth,
      bytes: buf.length,
    }),
  );
  return { name, width, height: h2, scrollWidth: sw2 };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(DOCS, { recursive: true });
  const profile = `/tmp/settings-layout-08-shots`;
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
  await cdp.send("Network.clearBrowserCookies");

  await login(cdp);

  const report = [];
  for (const tab of TABS) {
    report.push(await captureTab(cdp, tab, 1280));
    report.push(await captureTab(cdp, tab, 360));
  }

  fs.writeFileSync(path.join(DOCS, "shot-report.json"), JSON.stringify(report, null, 2));
  console.log("shots done", report.length);

  cdp.close();
  chrome.kill("SIGKILL");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
