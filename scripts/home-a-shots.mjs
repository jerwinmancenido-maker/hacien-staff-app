#!/usr/bin/env node
/**
 * Concept A Home screenshots: data / empty / staff × 1280 / 360.
 * Captures at REAL content height (no fixed tall canvas / empty tail).
 * Logs measured page height in px for each shot.
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

async function measurePageHeight(cdp) {
  const r = await cdp.send("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      // Content-only height: page header + Home cards. Do NOT use main.content's
      // box (its padding-bottom / tall viewport stretch inflate the canvas).
      let bottom = 0;
      const bump = (el) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        bottom = Math.max(bottom, r.bottom + window.scrollY);
      };
      bump(document.querySelector('.page-header'));
      bump(document.querySelector('.home-dashboard'));
      bump(document.querySelector('.home-getting-started'));
      for (const el of document.querySelectorAll('.home-dashboard .card, .home-getting-started')) {
        bump(el);
      }
      const pad = 12;
      return Math.max(400, Math.ceil(bottom + pad));
    })()`,
  });
  return Number(r.result?.value) || 800;
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

/**
 * Fail if the document (or Home cards) can scroll sideways.
 * Used at 320 and 360 — nothing may overflow the viewport width.
 */
async function assertNoHorizontalScroll(cdp, viewportWidth, label) {
  const r = await cdp.send("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      const doc = document.documentElement;
      const body = document.body;
      const scrollWidth = Math.max(doc.scrollWidth || 0, body.scrollWidth || 0);
      const clientWidth = Math.min(doc.clientWidth || Infinity, window.innerWidth || Infinity);
      const offenders = [];
      for (const el of document.querySelectorAll('.home-dashboard, .home-dashboard .card, .home-tax, .home-activity-card, .home-ra-row, .home-ct, .page-header')) {
        const r = el.getBoundingClientRect();
        if (r.right > clientWidth + 1) {
          offenders.push({
            cls: (el.className || '').toString().slice(0, 60),
            right: Math.round(r.right),
            width: Math.round(r.width),
          });
        }
      }
      return {
        scrollWidth,
        clientWidth,
        innerWidth: window.innerWidth,
        ok: scrollWidth <= clientWidth + 1 && offenders.length === 0,
        offenders: offenders.slice(0, 8),
      };
    })()`,
  });
  const info = r.result?.value ?? {};
  console.log(
    "scrollWidthCheck",
    label,
    `viewport=${viewportWidth}`,
    `scrollWidth=${info.scrollWidth}`,
    `clientWidth=${info.clientWidth}`,
    info.ok ? "ok" : "FAIL",
    info.offenders?.length ? JSON.stringify(info.offenders) : "",
  );
  if (!info.ok) {
    throw new Error(
      `Horizontal overflow at ${label} (viewport ${viewportWidth}): ` +
        `scrollWidth=${info.scrollWidth} clientWidth=${info.clientWidth} ` +
        `offenders=${JSON.stringify(info.offenders)}`,
    );
  }
  return info;
}

async function shotHome(cdp, name, w, readyExpr, { checkScroll = false } = {}) {
  // Lay out at a tall provisional height so content is not clipped while measuring.
  await goHome(cdp, w, 2400);
  if (readyExpr) await waitFor(cdp, readyExpr);
  await cdp.send("Runtime.evaluate", {
    expression: `window.scrollTo(0, 0); document.querySelector('.page-header, .home-dashboard')?.scrollIntoView({ block: 'start' });`,
  });
  await sleep(350);
  let height = await measurePageHeight(cdp);
  await setViewport(cdp, w, height);
  await sleep(200);
  height = await measurePageHeight(cdp);
  await setViewport(cdp, w, height);
  await sleep(150);
  await cdp.send("Runtime.evaluate", { expression: `window.scrollTo(0, 0);` });
  await sleep(100);
  let scrollInfo = null;
  if (checkScroll || w <= 360) {
    scrollInfo = await assertNoHorizontalScroll(cdp, w, name);
  }
  await shot(cdp, name, { x: 0, y: 0, width: w, height, scale: 1 });
  console.log("pageHeight", name, `${w}x${height}`);
  return { height, scrollInfo };
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
      "--window-size=1280,2400",
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
  const heights = {};
  const scrolls = {};
  const readyData = `!!document.querySelector('.home-sales') && !!document.querySelector('.home-kps')`;
  const readyEmpty = `!!document.querySelector('.home-sales.is-empty, .home-sales-empty, .home-sales')`;
  const readyStaff = `!!document.querySelector('.home-dashboard.is-staff, .home-na-card')`;

  async function record(name, w, readyExpr, opts) {
    const r = await shotHome(cdp, name, w, readyExpr, opts);
    heights[name] = r.height;
    if (r.scrollInfo) {
      scrolls[name] = {
        viewport: w,
        scrollWidth: r.scrollInfo.scrollWidth,
        clientWidth: r.scrollInfo.clientWidth,
        ok: r.scrollInfo.ok,
      };
    }
  }

  if (mode === "staff") {
    await login(cdp, staffEmail);
    await record("home-a-staff-1280.png", 1280, readyStaff);
    await record("home-a-staff-360.png", 360, readyStaff, { checkScroll: true });
  } else if (mode === "empty") {
    await login(cdp, adminEmail);
    await record("home-a-empty-1280.png", 1280, readyEmpty);
    await record("home-a-empty-360.png", 360, readyEmpty, { checkScroll: true });
  } else if (mode === "dense") {
    await login(cdp, adminEmail);
    await record("home-a-data-dense-1280.png", 1280, readyData);
    if (heights["home-a-data-dense-1280.png"] > 800) {
      throw new Error(
        `Dense 1280 page height ${heights["home-a-data-dense-1280.png"]} > 800`,
      );
    }
  } else {
    await login(cdp, adminEmail);
    await record("home-a-data-1280.png", 1280, readyData);
    await record("home-a-data-360.png", 360, readyData, { checkScroll: true });
    await record("home-a-data-320.png", 320, readyData, { checkScroll: true });
    if (heights["home-a-data-1280.png"] > 800) {
      throw new Error(`Data 1280 page height ${heights["home-a-data-1280.png"]} > 800`);
    }
  }

  cdp.close();
  chrome.kill("SIGKILL");
  console.log("shots done:", mode, JSON.stringify({ heights, scrolls }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
