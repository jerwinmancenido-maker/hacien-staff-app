/**
 * Safety guard for local throwaway seed / screenshot DB mutators.
 *
 * Refuses unless:
 *   1) DATABASE_URL host is an allowed local host,
 *   2) the database name looks like a throwaway test DB
 *      (contains test, shots, local, or dev — case-insensitive), and
 *   3) ALLOW_SEED_SHOTS=1 is set.
 *
 * Never prints the full DATABASE_URL or credentials — host / db name only.
 *
 * This repo has no docker-compose / CI compose MySQL service name checked
 * in, so the only allowed hosts are loopback.
 */

/** @type {readonly string[]} */
export const ALLOWED_LOCAL_DB_HOSTS = Object.freeze(["localhost", "127.0.0.1"]);

/** Database name must match this to look like a throwaway / test DB. */
export const TEST_LOOKING_DB_NAME_RE = /test|shots|local|dev/i;

/**
 * Extract hostname from a MySQL (or generic) connection URL.
 * Returns null when the URL is missing or unparseable.
 * @param {string | undefined | null} databaseUrl
 * @returns {string | null}
 */
export function parseDatabaseUrlHost(databaseUrl) {
  if (databaseUrl == null) return null;
  const raw = String(databaseUrl).trim();
  if (!raw) return null;
  try {
    // WHATWG URL needs a browser-ish scheme; mysql:// works after remap.
    const normalized = raw.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "http://");
    const u = new URL(normalized);
    const host = (u.hostname || "").trim().toLowerCase();
    return host || null;
  } catch {
    return null;
  }
}

/**
 * Extract the database / schema name (pathname without leading slash).
 * Returns null when missing or unparseable.
 * @param {string | undefined | null} databaseUrl
 * @returns {string | null}
 */
export function parseDatabaseUrlName(databaseUrl) {
  if (databaseUrl == null) return null;
  const raw = String(databaseUrl).trim();
  if (!raw) return null;
  try {
    const normalized = raw.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "http://");
    const u = new URL(normalized);
    const name = (u.pathname || "").replace(/^\//, "").split("/")[0] || "";
    // Strip query-ish leftovers if a driver stuffed params in the path.
    const clean = name.split("?")[0].trim();
    return clean || null;
  } catch {
    return null;
  }
}

/**
 * Pure check — no process.exit. Suitable for unit tests.
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns {{ ok: true, host: string, dbName: string } | { ok: false, error: string, host: string | null, dbName: string | null }}
 */
export function checkLocalSeedShots(env = process.env) {
  const optIn = env.ALLOW_SEED_SHOTS;
  if (optIn !== "1") {
    return {
      ok: false,
      host: null,
      dbName: null,
      error:
        "Refusing to run: ALLOW_SEED_SHOTS=1 is required (got " +
        (optIn === undefined || optIn === "" ? "unset" : JSON.stringify(String(optIn))) +
        "). This script mutates a throwaway local database only.",
    };
  }

  const url = env.DATABASE_URL;
  if (url == null || String(url).trim() === "") {
    return {
      ok: false,
      host: null,
      dbName: null,
      error: "Refusing to run: DATABASE_URL is missing or empty.",
    };
  }

  const host = parseDatabaseUrlHost(url);
  if (!host) {
    return {
      ok: false,
      host: null,
      dbName: null,
      error: "Refusing to run: DATABASE_URL host could not be parsed (garbage or invalid URL).",
    };
  }

  if (!ALLOWED_LOCAL_DB_HOSTS.includes(host)) {
    return {
      ok: false,
      host,
      dbName: parseDatabaseUrlName(url),
      error:
        `Refusing to run: DATABASE_URL host "${host}" is not local. ` +
        `Allowed hosts: ${ALLOWED_LOCAL_DB_HOSTS.join(", ")}.`,
    };
  }

  const dbName = parseDatabaseUrlName(url);
  if (!dbName) {
    return {
      ok: false,
      host,
      dbName: null,
      error:
        "Refusing to run: DATABASE_URL database name is missing. " +
        "Use a throwaway name containing test, shots, local, or dev.",
    };
  }

  if (!TEST_LOOKING_DB_NAME_RE.test(dbName)) {
    return {
      ok: false,
      host,
      dbName,
      error:
        `Refusing to run: DATABASE_URL database name "${dbName}" does not look like a test DB. ` +
        "Name must contain test, shots, local, or dev (case-insensitive).",
    };
  }

  return { ok: true, host, dbName };
}

/**
 * Exit non-zero with a clear message before any PrismaClient / query.
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @param {{ exit?: (code: number) => void, error?: (...args: unknown[]) => void }} [io]
 */
export function assertLocalSeedShotsOrExit(env = process.env, io = {}) {
  const result = checkLocalSeedShots(env);
  if (result.ok) return result;
  const log = io.error ?? console.error.bind(console);
  log(result.error);
  const exit = io.exit ?? ((code) => process.exit(code));
  exit(1);
  return result;
}
