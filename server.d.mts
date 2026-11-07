/**
 * Types for server.mjs (plain JS; `allowJs` is off, so this file is the
 * type contract the tests import against). Keep in sync with server.mjs.
 */
import type { Server } from "node:http";

export declare function parsePort(raw: string | undefined, fallback?: number): number;
export declare function retryDelayMs(attempt: number): number;
export declare function formatLogLine(
  level: string,
  message: string,
  extra?: Record<string, unknown>,
): Record<string, unknown>;
export declare function listenWithRetry(
  server: Server,
  port: number,
  maxWaitMs?: number,
): Promise<number>;
export declare const MAX_LISTEN_WAIT_MS: number;
