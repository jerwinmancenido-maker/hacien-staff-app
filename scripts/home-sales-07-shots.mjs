#!/usr/bin/env node
/**
 * Home Sales screenshots: 1280/360 with sample data + empty state,
 * one bar tooltip, and avatar menu after outside-click (focus on trigger).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME = process.env.CHROME || "/usr/bin/google-chrome-stable";
const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PORT = Number(process.env.SHOT_CDP_PORT || 9447);
const email = process.env.GUARD_EMAIL || "jerwin@example.com";
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

async function goHome(cdp, w, h) {
  await setViewport(cdp, w, h);
  await cdp.send("Page.navigate", { url: `${BASE}/` });
  await waitFor(cdp, `!!document.querySelector('.home-dashboard, .home-getting-started')`);
  await sleep(400);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(DOCS, { recursive: true });
  const profile = "/tmp/home-sales-07-shots";
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
      "--window-size=1280,1400",
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

  // --- Sample data shots ---
  for (const vp of [
    { w: 1280, h: 1600, tag: "1280" },
    { w: 360, h: 1800, tag: "360" },
  ]) {
    await goHome(cdp, vp.w, vp.h);
    await waitFor(cdp, `!!document.querySelector('.home-sales')`);
    await cdp.send("Runtime.evaluate", {
      expression: `document.querySelector('.home-sales')?.scrollIntoView({ block: 'start' }); window.scrollBy(0, -8);`,
    });
    await sleep(300);
    await shot(cdp, `home-sales-data-${vp.tag}.png`);
  }

  // Bar tooltip at 1280
  await goHome(cdp, 1280, 1200);
  await waitFor(cdp, `!!document.querySelector('.home-sales-bar')`);
  await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      document.querySelector('.home-sales')?.scrollIntoView({ block: 'center' });
      const bars = [...document.querySelectorAll('.home-sales-bar')];
      const cur = bars.find((b) => b.classList.contains('is-current')) || bars[bars.length - 1];
      cur?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      cur?.focus();
      return !!cur;
    })()`,
  });
  await sleep(250);
  await shot(cdp, `home-sales-bar-tooltip-1280.png`);

  // Avatar outside-click → focus on trigger
  await goHome(cdp, 1280, 900);
  await waitFor(cdp, `!!document.querySelector('.account-menu-trigger')`);
  await cdp.send("Runtime.evaluate", {
    expression: `document.querySelector('.account-menu-trigger')?.click()`,
  });
  await waitFor(cdp, `!!document.querySelector('.account-menu-panel')`);
  await sleep(200);
  // Dispatch a document mousedown whose target is outside the menu (body),
  // matching AccountMenu's listener — without activating another focusable.
  await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const body = document.body;
      const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window });
      Object.defineProperty(ev, 'target', { value: body });
      document.dispatchEvent(ev);
      return true;
    })()`,
  });
  await sleep(300);
  const focusState = await cdp.send("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      const t = document.querySelector('.account-menu-trigger');
      const panel = document.querySelector('.account-menu-panel');
      return {
        expanded: t?.getAttribute('aria-expanded'),
        panelOpen: !!panel,
        focusIsTrigger: document.activeElement === t,
        activeTag: document.activeElement?.tagName,
        activeClass: document.activeElement?.className,
      };
    })()`,
  });
  console.log("avatar outside-click focus", JSON.stringify(focusState.result?.value));
  if (!focusState.result?.value?.focusIsTrigger) {
    throw new Error("Expected focus on avatar trigger after outside click: " + JSON.stringify(focusState.result?.value));
  }
  await shot(cdp, `avatar-menu-after-outside-click-1280.png`);

  cdp.close();
  chrome.kill("SIGKILL");
  console.log("data shots done — run empty mode next");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
