#!/usr/bin/env node
/**
 * Avatar account-menu shots on Home: closed/open at 1280 and 360.
 * Also asserts 360 topbar chrome and menu contents (Settings for admin).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME = process.env.CHROME || "/usr/bin/google-chrome-stable";
const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PORT = Number(process.env.SHOT_CDP_PORT || 9455);
const email = process.env.GUARD_EMAIL || "jerwin@example.com";
const password = process.env.GUARD_PASSWORD || process.env.SEED_PASSWORD || "TestPass123!";
const OUT = process.env.SHOT_OUT || "/opt/cursor/artifacts/brand-06-avatar-menu";
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

async function goHome(cdp, w, h) {
  await setViewport(cdp, w, h);
  await cdp.send("Page.navigate", { url: `${BASE}/` });
  await waitFor(cdp, `!!document.querySelector('.account-menu-trigger')`);
  await sleep(400);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(DOCS, { recursive: true });
  const profile = "/tmp/brand-06-avatar-menu-shots";
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
    await goHome(cdp, vp.w, vp.h);

    // Ensure closed
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const t = document.querySelector('.account-menu-trigger');
        if (t?.getAttribute('aria-expanded') === 'true') t.click();
        return true;
      })()`,
    });
    await sleep(200);

    const closed = await evalJson(
      cdp,
      `(() => {
        const trigger = document.querySelector('.account-menu-trigger');
        const panel = document.querySelector('.account-menu-panel');
        const signOutBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Sign out' && !b.closest('.account-menu'));
        const crumbs = document.querySelector('.crumbs');
        const crumbsDisplay = crumbs ? getComputedStyle(crumbs).display : null;
        const name = document.querySelector('.account-menu-name');
        const nameDisplay = name ? getComputedStyle(name).display : null;
        const toggle = document.querySelector('.nav-toggle');
        const toggleVisible = toggle && getComputedStyle(toggle).display !== 'none';
        const searchToggle = document.querySelector('.topbar-search-toggle');
        const searchToggleVisible = searchToggle && getComputedStyle(searchToggle).display !== 'none';
        const bell = document.querySelector('.topbar-icon-btn[aria-label="Notifications"]');
        return {
          hasTrigger: !!trigger,
          ariaHaspopup: trigger?.getAttribute('aria-haspopup'),
          ariaExpanded: trigger?.getAttribute('aria-expanded'),
          panelOpen: !!panel,
          topbarSignOut: !!signOutBtn,
          crumbsDisplay,
          nameDisplay,
          toggleVisible,
          searchToggleVisible,
          bellVisible: !!(bell && getComputedStyle(bell).display !== 'none'),
        };
      })()`,
    );
    console.log("closed", vp.tag, JSON.stringify(closed));
    if (!closed?.hasTrigger) throw new Error("missing account-menu-trigger");
    if (closed.ariaHaspopup !== "menu") throw new Error("aria-haspopup missing");
    if (closed.ariaExpanded !== "false") throw new Error("expected closed");
    if (closed.panelOpen) throw new Error("panel should be closed");
    if (closed.topbarSignOut) throw new Error("top-bar Sign out button still present");
    if (vp.tag === "360") {
      if (!closed.toggleVisible) throw new Error("hamburger missing at 360");
      if (!closed.searchToggleVisible) throw new Error("search icon missing at 360");
      if (!closed.bellVisible) throw new Error("bell missing at 360");
      if (closed.crumbsDisplay !== "none") throw new Error("crumbs should hide at 360");
      if (closed.nameDisplay !== "none") throw new Error("avatar name should hide at 360");
    }
    await shot(cdp, `avatar-menu-closed-${vp.tag}.png`);

    // Open menu
    await cdp.send("Runtime.evaluate", {
      expression: `document.querySelector('.account-menu-trigger')?.click()`,
    });
    await waitFor(cdp, `!!document.querySelector('.account-menu-panel')`);
    await sleep(200);

    const open = await evalJson(
      cdp,
      `(() => {
        const trigger = document.querySelector('.account-menu-trigger');
        const panel = document.querySelector('.account-menu-panel');
        const text = panel?.innerText || '';
        const items = [...(panel?.querySelectorAll('[role="menuitem"]') || [])].map((el) => el.textContent?.trim());
        const who = panel?.querySelector('.account-menu-who')?.innerText?.trim();
        return {
          ariaExpanded: trigger?.getAttribute('aria-expanded'),
          who,
          items,
          text,
          hasSettings: items.includes('Settings'),
          hasSignOut: items.includes('Sign out'),
        };
      })()`,
    );
    console.log("open", vp.tag, JSON.stringify(open));
    if (open.ariaExpanded !== "true") throw new Error("aria-expanded not true");
    if (!open.hasSignOut) throw new Error("Sign out missing from menu");
    if (!open.hasSettings) throw new Error("admin should see Settings in menu");
    await shot(cdp, `avatar-menu-open-${vp.tag}.png`);

    // Esc closes and returns focus
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await sleep(200);
    const afterEsc = await evalJson(
      cdp,
      `(() => ({
        panel: !!document.querySelector('.account-menu-panel'),
        expanded: document.querySelector('.account-menu-trigger')?.getAttribute('aria-expanded'),
        focusIsTrigger: document.activeElement?.classList?.contains('account-menu-trigger'),
      }))()`,
    );
    console.log("afterEsc", vp.tag, JSON.stringify(afterEsc));
    if (afterEsc.panel || afterEsc.expanded !== "false") throw new Error("Esc did not close menu");
    if (!afterEsc.focusIsTrigger) throw new Error("Esc did not return focus to avatar");

    // Re-open and outside-click close
    await cdp.send("Runtime.evaluate", {
      expression: `document.querySelector('.account-menu-trigger')?.click()`,
    });
    await waitFor(cdp, `!!document.querySelector('.account-menu-panel')`);
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window });
        document.querySelector('.content')?.dispatchEvent(ev);
        return true;
      })()`,
    });
    await sleep(200);
    const afterOutside = await evalJson(
      cdp,
      `(() => ({
        panel: !!document.querySelector('.account-menu-panel'),
        expanded: document.querySelector('.account-menu-trigger')?.getAttribute('aria-expanded'),
      }))()`,
    );
    console.log("afterOutside", vp.tag, JSON.stringify(afterOutside));
    if (afterOutside.panel || afterOutside.expanded !== "false") throw new Error("outside click did not close");
  }

  cdp.close();
  chrome.kill();
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
