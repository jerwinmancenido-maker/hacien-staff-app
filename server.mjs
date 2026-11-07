/**
 * Custom production server for the HACIEN staff app on Hostinger shared
 * Node.js hosting. Plain ESM (.mjs) because the repo has no
 * `"type": "module"` and the lint rules forbid `require()` imports.
 *
 * Why this file exists (staging 503s, 2026-11-07): Hostinger's deploy
 * restarts the app while the previous process is still stopping, so the
 * new process can find the port already held. `next start` in production
 * has no retry for that case — Next 16.4.3 only retries EADDRINUSE in
 * dev (`start-server.js`: `isDev && err.code === 'EADDRINUSE'`) and
 * otherwise logs "Failed to start server" and exits 1. The deploy
 * supervisor then restarts the app, which fails the same way until
 * someone restarts it by hand in hPanel (twice on 2026-11-07, after
 * builds 01a1b4b7 and 01a1b50a, both with clean build logs).
 *
 * This server keeps the exact `next start` behaviour — same port from
 * process.env.PORT, same request handling via app.getRequestHandler() —
 * but retries the SAME port with backoff when it is in use (Hostinger's
 * proxy expects that exact port; moving to another port would still
 * 503), and logs every boot step as one JSON line so the next failure
 * shows up in the runtime logs instead of failing silently.
 *
 * Nothing here touches the database or runs migrations: those already
 * run at build time (`staging:build` / `live:build`), and Prisma
 * connects lazily on the first request.
 */

import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

/** How long to keep retrying a held port before giving up (2 minutes). */
const MAX_LISTEN_WAIT_MS = 120_000;

/**
 * Port from the environment, falling back when missing or invalid.
 * Hostinger sets PORT for the app; 3000 is the `next start` default.
 */
function parsePort(raw, fallback = 3000) {
  const n = typeof raw === "string" ? Number.parseInt(raw.trim(), 10) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : fallback;
}

/** Backoff between listen retries: 1s, 2s, 3s, then 5s flat. */
function retryDelayMs(attempt) {
  return Math.min(5000, Math.max(0, attempt) * 1000);
}

/** One structured log line. `extra` must never hold a secret value. */
function formatLogLine(level, message, extra) {
  return { ts: new Date().toISOString(), level, msg: message, ...(extra || {}) };
}

function logLine(level, message, extra) {
  console.log(JSON.stringify(formatLogLine(level, message, extra)));
}

/**
 * Listen on `port`, retrying on EADDRINUSE until `maxWaitMs` has passed.
 * Resolves with the attempt number that bound the port. Any other error,
 * or an EADDRINUSE that outlasts the budget, rejects.
 */
function listenWithRetry(server, port, maxWaitMs = MAX_LISTEN_WAIT_MS) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let attempt = 0;
    const tryListen = () => {
      attempt += 1;
      const onError = (err) => {
        server.removeListener("listening", onListening);
        const waitedMs = Date.now() - startedAt;
        if (err && err.code === "EADDRINUSE" && waitedMs < maxWaitMs) {
          const delayMs = retryDelayMs(attempt);
          logLine("warn", "port-in-use-retry", {
            port,
            attempt,
            waitedMs,
            retryInMs: delayMs,
            error: err.message,
          });
          setTimeout(tryListen, delayMs);
        } else {
          logLine("fatal", "listen-failed", {
            port,
            attempt,
            waitedMs,
            error: err && err.stack ? err.stack : String(err),
          });
          reject(err);
        }
      };
      const onListening = () => {
        server.removeListener("error", onError);
        resolve(attempt);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port);
    };
    tryListen();
  });
}

async function start() {
  const startedAt = Date.now();
  const port = parsePort(process.env.PORT, 3000);
  const pid = process.pid;
  // Presence only, never values: these names are safe to log.
  logLine("info", "boot", {
    pid,
    node: process.version,
    port,
    portSource: process.env.PORT ? "env" : "default",
    env: {
      databaseUrl: Boolean(process.env.DATABASE_URL),
      sessionSecret: Boolean(process.env.SESSION_SECRET),
      appUrl: Boolean(process.env.APP_URL),
    },
  });

  process.on("uncaughtException", (err) => {
    logLine("fatal", "uncaught-exception", {
      error: err && err.stack ? err.stack : String(err),
    });
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    logLine("fatal", "unhandled-rejection", {
      error: reason && reason.stack ? reason.stack : String(reason),
    });
    process.exit(1);
  });

  // Loaded here, not at the top, so importing this file for its helpers
  // (tests) never starts the app.
  const { default: next } = await import("next");
  const app = next({ dev: false, dir: fileURLToPath(new URL(".", import.meta.url)) });
  const handle = app.getRequestHandler();
  try {
    await app.prepare();
  } catch (err) {
    logLine("fatal", "prepare-failed", {
      error: err && err.stack ? err.stack : String(err),
    });
    process.exit(1);
  }
  logLine("info", "prepared", { ms: Date.now() - startedAt });

  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      // Last-resort guard so a handler throw never leaves the socket hanging.
      logLine("error", "request-handler-failed", {
        url: req.url,
        error: err && err.stack ? err.stack : String(err),
      });
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end("Internal Server Error");
      }
    });
  });

  let attempts = 0;
  try {
    attempts = await listenWithRetry(server, port);
  } catch {
    process.exit(1);
  }
  logLine("info", "listening", { port, pid, attempts, ms: Date.now() - startedAt });

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logLine("info", "shutdown", { signal, port, pid });
    server.close(() => process.exit(0));
    // Never hang the deploy stop: force exit if connections linger.
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  start().catch((err) => {
    logLine("fatal", "boot-failed", {
      error: err && err.stack ? err.stack : String(err),
    });
    process.exit(1);
  });
}

export { parsePort, retryDelayMs, formatLogLine, listenWithRetry, MAX_LISTEN_WAIT_MS };
