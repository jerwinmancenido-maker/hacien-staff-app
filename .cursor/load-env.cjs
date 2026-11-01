// Loaded via NODE_OPTIONS so Node (vitest, next, prisma CLI) sees gitignored .env.
// Only fills unset keys — never overrides Cursor secrets or an explicit export.
/* eslint-disable @typescript-eslint/no-require-imports -- CJS preload for NODE_OPTIONS --require */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

function loadEnvFile(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    return;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue;
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

loadEnvFile(path.join(process.cwd(), ".env"));
