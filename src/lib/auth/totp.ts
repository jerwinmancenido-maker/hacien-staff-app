import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync } from "node:crypto";

/**
 * S-58: two-step sign-in with a standard authenticator app (TOTP, RFC 6238).
 * No new packages: base32 + HMAC-SHA1 TOTP are implemented here, and the
 * stored secret is AES-256-GCM encrypted with a key derived from
 * SESSION_SECRET. Rotating SESSION_SECRET invalidates enrolled secrets —
 * affected staff re-enroll (or an Admin resets them).
 */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Buffer): string {
  let out = "";
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  while (out.length % 8 !== 0) out += "=";
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.trim().replace(/=+$/, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error("Invalid base32 secret.");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** TOTP code for a Unix time (seconds). Step 30s, 6 digits, SHA-1. */
export function totpCode(secret: string, timeSeconds: number): string {
  const counter = Math.floor(timeSeconds / 30);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", base32Decode(secret)).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

/** Accepts the current step and one step either side (clock skew). */
export function verifyTotpCode(secret: string, code: string, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  for (const step of [-1, 0, 1]) {
    if (totpCode(secret, nowSeconds + step * 30) === code) return true;
  }
  return false;
}

function totpKey(): Buffer {
  const sessionSecret = process.env.SESSION_SECRET ?? "";
  if (sessionSecret.length < 16) throw new Error("SESSION_SECRET must be at least 16 characters for two-step sign-in.");
  return scryptSync(sessionSecret, "hacien-totp", 32);
}

/** Encrypts a TOTP secret for storage. Format: base64(iv):base64(authTag):base64(ciphertext). */
export function encryptTotpSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", totpKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decryptTotpSecret(stored: string): string {
  const [iv, tag, ciphertext] = stored.split(":");
  if (!iv || !tag || !ciphertext) throw new Error("Stored two-step secret is not readable.");
  const decipher = createDecipheriv("aes-256-gcm", totpKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8");
}

export function totpSetupUri(secret: string, email: string): string {
  return `otpauth://totp/HACIEN:${encodeURIComponent(email)}?secret=${secret}&issuer=HACIEN&algorithm=SHA1&digits=6&period=30`;
}
