import { randomBytes } from "node:crypto";

/**
 * S-93: random, hard-to-guess tracking references for sales orders.
 *
 * The sequential SO number (SO-2026-0004) is guessable — anyone can walk to
 * the next number. New orders instead get a tracking reference staff can
 * share with the customer for order tracking, while the SO number keeps
 * working exactly as before (old refs keep working).
 *
 * Format: TRK- + 16 chars from the base32 alphabet (A–Z, 2–7), 80 bits of
 * randomness from crypto.randomBytes. The Gateway/website lookup that
 * resolves a tracking reference to an order status is a separate
 * Gateway-side follow-up — this is the staff-app side: minting + storage.
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function newTrackingRef(): string {
  return `TRK-${newTrackingRefBits()}`;
}

/** 16 base32 chars (80 bits) from 10 random bytes, without padding. */
export function newTrackingRefBits(): string {
  const bytes = randomBytes(10);
  let out = "";
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
}

export function isTrackingRef(value: string | null | undefined): boolean {
  return !!value && /^TRK-[A-Z2-7]{16}$/.test(value);
}

/** Generates a reference no existing order uses yet. Retries on collision (near-impossible at 80 bits). */
export async function generateUniqueTrackingRef(
  exists: (ref: string) => Promise<boolean>,
  attempts = 5,
): Promise<string> {
  for (let i = 0; i < attempts; i++) {
    const ref = `TRK-${newTrackingRefBits()}`;
    if (!(await exists(ref))) return ref;
  }
  throw new Error("Could not mint a unique tracking reference.");
}
