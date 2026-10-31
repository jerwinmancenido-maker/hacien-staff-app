#!/usr/bin/env node
/**
 * Product-owner follow-up shots: Home (unboxed) + Payables (flag on) at 360 / 1280.
 * Also asserts mobile nav is collapsed and Payables tab labels are fully readable.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME = process.env.CHROME || "/usr/bin/google-chrome-stable";
const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PORT = Number(process.env.SHOT_CDP_PORT || 9444);
const email = process.env.GUARD_EMAIL || "jerwin@example.com";
const password = process.env.GUARD_PASSWORD || process.env.SEED_PASSWORD || "TestPass123!";
const OUT = process.env.SHOT_OUT || "/opt/cursor/artifacts/brand-06-po-fixes";
const DOCS = process.env.SHOT_DOCS || "/workspace/docs/screenshots/brand-06";

const VIEWPORTS = [
  { w: 1280, h: 1200, tag: "1280" },
  { w: 1024, h: 1000, tag: "1024" },
  { w: 360, h: 900, tag: "360" },
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
  const profile = "/tmp/brand-06-po-shots";
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

  // Home shots + unboxed sections check
  for (const vp of VIEWPORTS) {
    if (vp.tag === "1024") continue; // home only 360/1280
    await setViewport(cdp, vp.w, vp.h);
    await cdp.send("Page.navigate", { url: `${BASE}/` });
    await waitFor(cdp, `!!document.querySelector('.home-dashboard, .home-getting-started, .page-header')`);
    await sleep(400);
    const homeCheck = await evalJson(
      cdp,
      `(() => {
        const sections = [...document.querySelectorAll('.home-section')];
        const boxed = sections.filter((s) => {
          const st = getComputedStyle(s);
          return st.borderWidth !== '0px' && st.borderStyle !== 'none' && st.backgroundColor !== 'rgba(0, 0, 0, 0)' && st.backgroundColor !== 'transparent';
        });
        const toggle = document.querySelector('.nav-toggle');
        const sidebar = document.querySelector('.sidebar');
        const toggleVisible = toggle && getComputedStyle(toggle).display !== 'none';
        const sidebarTransform = sidebar ? getComputedStyle(sidebar).transform : null;
        const navOpen = document.querySelector('.frame')?.classList.contains('nav-open');
        return {
          sectionCount: sections.length,
          boxedCount: boxed.length,
          toggleVisible,
          navOpen: !!navOpen,
          sidebarTransform,
        };
      })()`,
    );
    console.log("home", vp.tag, JSON.stringify(homeCheck));
    if (vp.tag === "360" && !homeCheck?.toggleVisible) throw new Error("nav-toggle not visible at 360");
    if (vp.tag === "360" && homeCheck?.navOpen) throw new Error("nav should start collapsed at 360");
    await shot(cdp, `home-po-fixes-${vp.tag}.png`);
  }

  // Payables: tabs readable, no 2307, mobile nav collapsed
  for (const vp of VIEWPORTS) {
    await setViewport(cdp, vp.w, vp.h);
    await cdp.send("Page.navigate", { url: `${BASE}/payables` });
    await waitFor(cdp, `document.body.innerText.includes('Payables')`);
    await sleep(500);
    const payCheck = await evalJson(
      cdp,
      `(() => {
        const body = document.body.innerText;
        const tabs = [...document.querySelectorAll('.pill-tab')];
        const labels = tabs.map((t) => (t.querySelector('.pill-tab-label')?.textContent || t.textContent || '').trim());
        const clipped = tabs.filter((t) => {
          const lab = t.querySelector('.pill-tab-label') || t;
          return lab.scrollWidth > lab.clientWidth + 1;
        }).map((t) => (t.textContent || '').trim());
        const has2307 = /2307 to issue|EWT pending certificate/i.test(body);
        const toggle = document.querySelector('.nav-toggle');
        const toggleVisible = toggle && getComputedStyle(toggle).display !== 'none';
        const navOpen = document.querySelector('.frame')?.classList.contains('nav-open');
        return { labels, clipped, has2307, toggleVisible, navOpen: !!navOpen, path: location.pathname };
      })()`,
    );
    console.log("payables", vp.tag, JSON.stringify(payCheck));
    if (payCheck?.path !== "/payables") throw new Error("Payables not reachable — is PAYABLES_ENABLED on?");
    if (payCheck?.has2307) throw new Error("2307 UI visible while PAYABLES_2307_ENABLED should be off");
    if (payCheck?.clipped?.length) throw new Error(`Clipped tab labels at ${vp.tag}: ${payCheck.clipped.join(",")}`);
    if (vp.tag === "360" && !payCheck?.toggleVisible) throw new Error("nav-toggle missing on Payables 360");
    if (vp.tag === "360" || vp.tag === "1280") {
      await shot(cdp, `payables-po-fixes-${vp.tag}.png`);
    }
  }

  // Spot-check a few other routes at 360 for collapsed nav
  for (const route of ["/customers", "/quotes", "/sales-orders", "/billing", "/settings"]) {
    await setViewport(cdp, 360, 900);
    await cdp.send("Page.navigate", { url: `${BASE}${route}` });
    await sleep(600);
    const check = await evalJson(
      cdp,
      `(() => {
        const toggle = document.querySelector('.nav-toggle');
        const toggleVisible = toggle && getComputedStyle(toggle).display !== 'none';
        const navOpen = document.querySelector('.frame')?.classList.contains('nav-open');
        const sidebar = document.querySelector('.sidebar');
        const tx = sidebar ? getComputedStyle(sidebar).transform : '';
        return { route: location.pathname, toggleVisible, navOpen: !!navOpen, tx };
      })()`,
    );
    console.log("nav", JSON.stringify(check));
    if (!check?.toggleVisible) throw new Error(`nav-toggle missing on ${route}`);
    if (check?.navOpen) throw new Error(`nav open by default on ${route}`);
  }

  cdp.close();
  chrome.kill();
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
