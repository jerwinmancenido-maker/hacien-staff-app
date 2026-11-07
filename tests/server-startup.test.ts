/**
 * Custom production server (server.mjs): port parsing, listen retry, and
 * structured boot logs. The retry is what saves a deploy when Hostinger
 * restarts the app while the old process still holds the port — `next
 * start` in production exits 1 on EADDRINUSE with no retry.
 */
import { createServer, type Server } from "node:http";
import { describe, expect, it } from "vitest";

import { formatLogLine, listenWithRetry, MAX_LISTEN_WAIT_MS, parsePort, retryDelayMs } from "../server.mjs";

describe("parsePort", () => {
  it("uses the env port when valid", () => {
    expect(parsePort("3000")).toBe(3000);
    expect(parsePort("8080", 3000)).toBe(8080);
    expect(parsePort("  3001  ")).toBe(3001);
  });

  it("falls back on missing or invalid values", () => {
    expect(parsePort(undefined)).toBe(3000);
    expect(parsePort("", 4000)).toBe(4000);
    expect(parsePort("abc")).toBe(3000);
    expect(parsePort("0")).toBe(3000);
    expect(parsePort("-1")).toBe(3000);
    expect(parsePort("70000")).toBe(3000);
  });
});

describe("retryDelayMs", () => {
  it("backs off then caps at 5s", () => {
    expect(retryDelayMs(1)).toBe(1000);
    expect(retryDelayMs(2)).toBe(2000);
    expect(retryDelayMs(3)).toBe(3000);
    expect(retryDelayMs(4)).toBe(4000);
    expect(retryDelayMs(5)).toBe(5000);
    expect(retryDelayMs(50)).toBe(5000);
  });
});

describe("formatLogLine", () => {
  it("builds one JSON-ready line with timestamp, level and message", () => {
    const line = formatLogLine("info", "boot", { pid: 123, port: 3000 });
    expect(line.level).toBe("info");
    expect(line.msg).toBe("boot");
    expect(line.pid).toBe(123);
    expect(line.port).toBe(3000);
    expect(typeof line.ts).toBe("string");
    expect(Number.isNaN(Date.parse(String(line.ts)))).toBe(false);
    expect(() => JSON.stringify(line)).not.toThrow();
  });
});

describe("MAX_LISTEN_WAIT_MS", () => {
  it("gives the old process two minutes to drain", () => {
    expect(MAX_LISTEN_WAIT_MS).toBe(120_000);
  });
});

describe("listenWithRetry", () => {
  const freePort = async (): Promise<number> => {
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, resolve));
    const port = (probe.address() as { port: number }).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    return port;
  };
  const close = (server: Server): Promise<void> =>
    new Promise<void>((resolve) => server.close(() => resolve()));

  it("binds at once when the port is free", async () => {
    const port = await freePort();
    const server = createServer((_req, res) => res.end("ok"));
    const attempts = await listenWithRetry(server, port, 5_000);
    expect(attempts).toBe(1);
    expect((server.address() as { port: number }).port).toBe(port);
    await close(server);
  });

  it("retries the SAME port and binds once the holder lets go", async () => {
    const port = await freePort();
    const holder = createServer((_req, res) => res.end("held"));
    await new Promise<void>((resolve) => holder.listen(port, resolve));
    const server = createServer((_req, res) => res.end("ok"));
    const pending = listenWithRetry(server, port, 10_000);
    // The old process drains a moment later, like Hostinger stopping it.
    setTimeout(() => void close(holder), 400);
    const attempts = await pending;
    expect(attempts).toBeGreaterThanOrEqual(2);
    expect((server.address() as { port: number }).port).toBe(port);
    await close(server);
  });

  it("gives up with EADDRINUSE when the port never frees", async () => {
    const port = await freePort();
    const holder = createServer((_req, res) => res.end("held"));
    await new Promise<void>((resolve) => holder.listen(port, resolve));
    const server = createServer((_req, res) => res.end("ok"));
    await expect(listenWithRetry(server, port, 300)).rejects.toMatchObject({
      code: "EADDRINUSE",
    });
    await close(holder);
  });
});
