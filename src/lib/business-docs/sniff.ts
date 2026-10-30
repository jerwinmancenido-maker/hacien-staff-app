// Upload checks: the file type comes from the first bytes (magic numbers), not
// from the name or the browser's MIME type, and must agree with the extension.

export type AllowedType = { mime: "application/pdf" | "image/jpeg" | "image/png"; label: "PDF" | "JPG" | "PNG" };

const PDF: AllowedType = { mime: "application/pdf", label: "PDF" };
const JPEG: AllowedType = { mime: "image/jpeg", label: "JPG" };
const PNG: AllowedType = { mime: "image/png", label: "PNG" };

const EXTENSIONS: Record<string, AllowedType> = { pdf: PDF, jpg: JPEG, jpeg: JPEG, png: PNG };

const startsWith = (bytes: Uint8Array, sig: readonly number[]) => bytes.length >= sig.length && sig.every((b, i) => bytes[i] === b);

/** PDF ("%PDF-"), PNG (\x89PNG\r\n\x1a\n) or JPEG (FF D8 FF); anything else is null. */
export function sniffFileType(bytes: Uint8Array): AllowedType | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return PDF;
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return PNG;
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return JPEG;
  return null;
}

export const DEFAULT_UPLOAD_MAX_MB = 10;

/** Upload size limit from UPLOAD_MAX_MB (default 10 MB, clamped to 1–50). */
export function uploadMaxMb(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.UPLOAD_MAX_MB);
  if (!env.UPLOAD_MAX_MB || !Number.isFinite(n) || n <= 0) return DEFAULT_UPLOAD_MAX_MB;
  return Math.min(50, Math.max(1, Math.floor(n)));
}

export function uploadMaxBytes(env: Record<string, string | undefined> = process.env): number {
  return uploadMaxMb(env) * 1024 * 1024;
}

/** Display name only (never used on disk): no path parts or control characters, at most 255 chars. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f"]/g, "").trim();
  return (cleaned || "document").slice(-255);
}

export type UploadCheck = { ok: true; type: AllowedType; fileName: string } | { ok: false; error: string };

export function checkUpload(file: { name: string; size: number }, head: Uint8Array, maxBytes: number): UploadCheck {
  if (file.size <= 0) return { ok: false, error: "Pick a file to upload." };
  if (file.size > maxBytes) return { ok: false, error: `The file is too big. The limit is ${Math.round(maxBytes / 1024 / 1024)} MB.` };
  const fileName = cleanFileName(file.name);
  const ext = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
  const byName = EXTENSIONS[ext];
  if (!byName) return { ok: false, error: "Upload a PDF, JPG or PNG file." };
  const sniffed = sniffFileType(head);
  if (!sniffed) return { ok: false, error: "This file isn't a real PDF, JPG or PNG." };
  if (sniffed.mime !== byName.mime) return { ok: false, error: `This file is a ${sniffed.label}, but its name ends in .${ext}. Rename it and try again.` };
  return { ok: true, type: sniffed, fileName };
}
