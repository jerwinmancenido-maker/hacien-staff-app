// Magic-byte sniff for company logo files (PNG / JPEG / WebP). No new deps.

export type LogoMime = "image/png" | "image/jpeg" | "image/webp";

const startsWith = (bytes: Uint8Array, sig: readonly number[]) =>
  bytes.length >= sig.length && sig.every((b, i) => bytes[i] === b);

/**
 * Detect logo image type from the file head.
 * - PNG: 89 50 4E 47
 * - JPEG: FF D8 FF
 * - WebP: RIFF....WEBP
 */
export function sniffLogoMime(bytes: Uint8Array): LogoMime | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  // RIFF....WEBP — bytes 0-3 "RIFF", bytes 8-11 "WEBP"
  if (
    bytes.length >= 12 &&
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}
