// Philippine mobile numbers (Q15, S-94).
// Accepted input: 09xxxxxxxxx, +639xxxxxxxxx, 639xxxxxxxxx, with optional
// spaces or dashes. Everything else is rejected — including landlines.

/** Normalized form (+639xxxxxxxxx), or null when the input is not a PH mobile. */
export function normalizePhMobile(input: string): string | null {
  const digits = input.replace(/[\s-]/g, "");
  let local: string | null = null;
  if (/^09\d{9}$/.test(digits)) local = `63${digits.slice(1)}`;
  else if (/^\+639\d{9}$/.test(digits)) local = digits.slice(1);
  else if (/^639\d{9}$/.test(digits)) local = digits;
  if (!local) return null;
  return `+${local}`;
}

export function isValidPhMobile(input: string): boolean {
  return normalizePhMobile(input) !== null;
}

/**
 * Masked for display in the Admin send log: all but the last 4 digits hidden.
 * Example: +639171234567 -> +63******4567.
 */
export function maskPhMobile(normalized: string): string {
  const digits = normalized.replace(/^\+/, "");
  if (digits.length <= 4) return "****";
  return `+${digits.slice(0, 2)}${"*".repeat(digits.length - 6)}${digits.slice(-4)}`;
}

/** Mask any recipient for display: PH mobiles by the rule above, emails by local part. */
export function maskRecipient(channel: "sms" | "email", recipient: string): string {
  if (channel === "sms") {
    const normalized = normalizePhMobile(recipient) ?? recipient;
    return maskPhMobile(normalized);
  }
  const at = recipient.indexOf("@");
  if (at <= 1) return "****";
  return `${recipient[0]}****${recipient.slice(at)}`;
}

export function isValidEmail(input: string): boolean {
  return /^\S+@\S+\.\S+$/.test(input.trim());
}
