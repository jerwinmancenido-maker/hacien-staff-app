import { createHmac, randomBytes } from "node:crypto";

function secret(): string {
  const s = process.env.SESSION_SECRET ?? process.env.AUTH_SECRET;
  if (!s || s.length < 16) {
    throw new Error("SESSION_SECRET is missing or too short. Set it in .env (see .env.example).");
  }
  return s;
}

/** Random URL-safe token for cookies and email links. */
export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Only this hash is stored in the database, never the raw token. */
export function hashToken(token: string): string {
  return createHmac("sha256", secret()).update(token).digest("hex");
}
