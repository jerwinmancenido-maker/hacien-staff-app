// Business document uploads: type sniffing, size limit, file names, storage
// paths and expiry badges. (Upload/download against MySQL: tests/db.)

import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkUpload, cleanFileName, sniffFileType, uploadMaxBytes, uploadMaxMb } from "@/lib/business-docs/sniff";
import { expiringCutoff, expiryLabel, expiryStatus } from "@/lib/business-docs/expiry";
import { isStorageKey, newStorageKey, storagePath, uploadDir } from "@/lib/business-docs/storage";
import { contentDisposition } from "@/lib/business-docs/download";

const bytes = (...b: number[]) => new Uint8Array(b);
const PDF = new TextEncoder().encode("%PDF-1.7\n%âãÏÓ\n");
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13);
const JPG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46);
const HTML = new TextEncoder().encode("<html><script>alert(1)</script>");
const MB = 1024 * 1024;

describe("file type sniffing (magic bytes)", () => {
  it("recognises PDF, PNG and JPEG", () => {
    expect(sniffFileType(PDF)?.mime).toBe("application/pdf");
    expect(sniffFileType(PNG)?.mime).toBe("image/png");
    expect(sniffFileType(JPG)?.mime).toBe("image/jpeg");
  });

  it("rejects everything else, including near misses", () => {
    expect(sniffFileType(HTML)).toBeNull();
    expect(sniffFileType(new TextEncoder().encode("PDF-1.7"))).toBeNull();
    expect(sniffFileType(bytes(0x89, 0x50, 0x4e, 0x47))).toBeNull();
    expect(sniffFileType(bytes(0xff, 0xd8))).toBeNull();
    expect(sniffFileType(bytes())).toBeNull();
    expect(sniffFileType(bytes(0x50, 0x4b, 0x03, 0x04))).toBeNull(); // zip / docx
  });

  it("checks the bytes, not the name: an HTML file named .pdf is refused", () => {
    expect(checkUpload({ name: "permit.pdf", size: 100 }, HTML, 10 * MB)).toEqual({ ok: false, error: "This file isn't a real PDF, JPG or PNG." });
  });

  it("the extension must agree with the bytes", () => {
    const r = checkUpload({ name: "permit.pdf", size: 100 }, PNG, 10 * MB);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/is a PNG, but its name ends in \.pdf/);
  });

  it("only PDF / JPG / PNG extensions", () => {
    expect(checkUpload({ name: "permit.exe", size: 100 }, PDF, 10 * MB)).toEqual({ ok: false, error: "Upload a PDF, JPG or PNG file." });
    expect(checkUpload({ name: "permit", size: 100 }, PDF, 10 * MB).ok).toBe(false);
    expect(checkUpload({ name: "Permit.PDF", size: 100 }, PDF, 10 * MB)).toMatchObject({ ok: true, type: { mime: "application/pdf" } });
    expect(checkUpload({ name: "scan.jpeg", size: 100 }, JPG, 10 * MB)).toMatchObject({ ok: true, type: { mime: "image/jpeg" } });
  });
});

describe("size limit", () => {
  it("defaults to 10 MB and reads UPLOAD_MAX_MB", () => {
    expect(uploadMaxMb({})).toBe(10);
    expect(uploadMaxMb({ UPLOAD_MAX_MB: "5" })).toBe(5);
    expect(uploadMaxMb({ UPLOAD_MAX_MB: "nope" })).toBe(10);
    expect(uploadMaxMb({ UPLOAD_MAX_MB: "0" })).toBe(10);
    expect(uploadMaxMb({ UPLOAD_MAX_MB: "500" })).toBe(50);
    expect(uploadMaxBytes({})).toBe(10 * MB);
  });

  it("accepts exactly the limit and refuses one byte more, and empty files", () => {
    expect(checkUpload({ name: "a.pdf", size: 10 * MB }, PDF, 10 * MB).ok).toBe(true);
    expect(checkUpload({ name: "a.pdf", size: 10 * MB + 1 }, PDF, 10 * MB)).toEqual({ ok: false, error: "The file is too big. The limit is 10 MB." });
    expect(checkUpload({ name: "a.pdf", size: 0 }, PDF, 10 * MB).ok).toBe(false);
  });
});

describe("file names and storage paths", () => {
  it("keeps only the base name for display", () => {
    expect(cleanFileName("../../etc/passwd.pdf")).toBe("passwd.pdf");
    expect(cleanFileName("C:\\Users\\me\\BIR 2303.pdf")).toBe("BIR 2303.pdf");
    expect(cleanFileName('bad"\u0000name.pdf')).toBe("badname.pdf");
    expect(cleanFileName("")).toBe("document");
  });

  it("storage keys are random and the only thing used on disk", () => {
    const a = newStorageKey();
    const b = newStorageKey();
    expect(a).not.toBe(b);
    expect(isStorageKey(a)).toBe(true);
    const dir = path.resolve("/srv/uploads");
    expect(storagePath(a, dir)).toBe(path.join(dir, a));
  });

  it("path traversal is impossible: anything but a well-formed key is refused", () => {
    const dir = path.resolve("/srv/uploads");
    for (const key of ["../etc/passwd", "..", "/etc/passwd", "c0123/../../x", "permit.pdf", "C" + "a".repeat(32), "c" + "g".repeat(32), ""]) {
      expect(() => storagePath(key, dir), key).toThrow();
    }
  });

  it("UPLOAD_DIR defaults to ./.uploads and may not be under public/ or .next/", () => {
    const cwd = path.resolve("/app");
    expect(uploadDir({}, cwd)).toBe(path.join(cwd, ".uploads"));
    expect(uploadDir({ UPLOAD_DIR: "/home/u1/hacien-uploads/staging" }, cwd)).toBe("/home/u1/hacien-uploads/staging");
    expect(() => uploadDir({ UPLOAD_DIR: "public/uploads" }, cwd)).toThrow(/public/);
    expect(() => uploadDir({ UPLOAD_DIR: "/app/.next/cache" }, cwd)).toThrow(/\.next/);
    expect(() => uploadDir({ UPLOAD_DIR: "./public" }, cwd)).toThrow(/public/);
    // A sibling named like it is fine.
    expect(uploadDir({ UPLOAD_DIR: "/app/public-uploads" }, cwd)).toBe("/app/public-uploads");
  });

  it("Content-Disposition is an attachment with a safe ASCII fallback", () => {
    expect(contentDisposition("BIR 2303.pdf")).toBe(`attachment; filename="BIR 2303.pdf"; filename*=UTF-8''BIR%202303.pdf`);
    expect(contentDisposition('Mayor\'s "permit" Parañaque.pdf')).toBe(
      `attachment; filename="Mayor's _permit_ Para_aque.pdf"; filename*=UTF-8''Mayor's%20%22permit%22%20Para%C3%B1aque.pdf`,
    );
  });
});

describe("expiry status", () => {
  const today = new Date("2026-10-30T00:00:00.000Z");
  const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

  it("past = Expired, ≤ 30 days = Expires in N days, later = Valid, none = No expiry", () => {
    expect(expiryStatus(d("2026-10-29"), today, 30)).toEqual({ state: "expired", days: -1 });
    expect(expiryStatus(d("2026-10-30"), today, 30)).toEqual({ state: "expiring", days: 0 });
    expect(expiryStatus(d("2026-10-31"), today, 30)).toEqual({ state: "expiring", days: 1 });
    expect(expiryStatus(d("2026-11-29"), today, 30)).toEqual({ state: "expiring", days: 30 });
    expect(expiryStatus(d("2026-11-30"), today, 30)).toEqual({ state: "valid", days: 31 });
    expect(expiryStatus(null, today, 30)).toEqual({ state: "none" });
  });

  it("labels", () => {
    expect(expiryLabel({ state: "expired", days: -3 })).toBe("Expired");
    expect(expiryLabel({ state: "expiring", days: 0 })).toBe("Expires today");
    expect(expiryLabel({ state: "expiring", days: 1 })).toBe("Expires in 1 day");
    expect(expiryLabel({ state: "expiring", days: 12 })).toBe("Expires in 12 days");
    expect(expiryLabel({ state: "valid", days: 90 })).toBe("Valid");
    expect(expiryLabel({ state: "none" })).toBe("No expiry");
  });

  it("the warning window comes from the setting", () => {
    expect(expiryStatus(d("2026-11-20"), today, 7).state).toBe("valid");
    expect(expiryStatus(d("2026-11-20"), today, 30).state).toBe("expiring");
    expect(expiringCutoff(today, 30).toISOString().slice(0, 10)).toBe("2026-11-29");
  });
});

describe("proxy", () => {
  it("answers 401 (not a login redirect) for file downloads without a session cookie", async () => {
    const { NextRequest } = await import("next/server");
    const { proxy } = await import("@/proxy");
    const file = proxy(new NextRequest("http://localhost/files/business-documents/abc"));
    expect(file.status).toBe(401);
    expect(file.headers.get("cache-control")).toBe("private, no-store");
    const page = proxy(new NextRequest("http://localhost/customers"));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toBe("http://localhost/login");
  });
});
