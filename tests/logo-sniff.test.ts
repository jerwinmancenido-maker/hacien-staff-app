import { describe, expect, it } from "vitest";
import { sniffLogoMime } from "@/lib/print/logo-sniff";

describe("sniffLogoMime", () => {
  it("accepts PNG (89 50 4E 47)", () => {
    const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0);
    expect(sniffLogoMime(png)).toBe("image/png");
  });

  it("accepts JPEG (FF D8 FF)", () => {
    const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0);
    expect(sniffLogoMime(jpeg)).toBe("image/jpeg");
  });

  it("accepts WebP (RIFF....WEBP)", () => {
    const webp = new Uint8Array(12);
    webp.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
    webp.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
    expect(sniffLogoMime(webp)).toBe("image/webp");
  });

  it("rejects anything else (caller should respond 415)", () => {
    expect(sniffLogoMime(Uint8Array.of(0x00, 0x01, 0x02, 0x03))).toBeNull();
    expect(sniffLogoMime(Uint8Array.of(0x25, 0x50, 0x44, 0x46))).toBeNull(); // PDF
    expect(sniffLogoMime(new Uint8Array(0))).toBeNull();
  });
});
