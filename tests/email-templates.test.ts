import { describe, expect, it } from "vitest";
import { accountEmailHtml } from "@/lib/email-templates";

/** HTML reset/invite email: a button staff can tap, with the plain link as fallback. */
describe("accountEmailHtml", () => {
  const html = accountEmailHtml({
    name: "Jerwin",
    heading: "Reset your password",
    intro: "Someone asked to reset your HACIEN staff app password.",
    buttonLabel: "Reset password",
    url: "https://app.haciensolutions.com/reset-password?token=abc123",
    expiryLine: "This link works for 1 hour.",
    ignoreNote: "If it wasn't you, ignore this email — your password stays the same.",
  });

  it("has a button linking to the reset page", () => {
    expect(html).toContain('href="https://app.haciensolutions.com/reset-password?token=abc123"');
    expect(html).toContain(">Reset password</a>");
    expect(html).toContain("background:#2563EB");
  });

  it("prints the plain link as a fallback and states the expiry", () => {
    expect(html).toContain("Button not working? Copy this link into your browser:");
    expect(html).toContain("https://app.haciensolutions.com/reset-password?token=abc123");
    expect(html).toContain("This link works for 1 hour.");
    expect(html).toContain("If it wasn't you, ignore this email");
  });

  it("looks like a designed email, not a bare page", () => {
    expect(html).toContain("background:#f2f2f2");
    expect(html).toContain("background:#ffffff;border:1px solid #e5e5e5");
    expect(html).toContain("background:#111111");
    expect(html).toContain("HACIEN Information Technology Solutions");
  });

  it("renders a bulletproof button cell and a readable header", () => {
    // Outlook ignores padding/background on <a>, but honors the cell's
    // bgcolor, so the button keeps its blue block there too.
    expect(html).toContain('bgcolor="#2563EB"');
    expect(html).toContain('background:#2563EB;border-radius:6px');
    expect(html).toContain("color:#cccccc");
  });

  it("uses no images and escapes user-controlled values", () => {
    expect(html).not.toContain("<img");
    const nasty = accountEmailHtml({
      name: "<script>alert(1)</script>",
      heading: "Reset your password",
      intro: "x",
      buttonLabel: "Reset password",
      url: "https://example.com/?a=1&b=2",
      expiryLine: "1 hour.",
      ignoreNote: "ignore.",
    });
    expect(nasty).not.toContain("<script>");
    expect(nasty).toContain("&lt;script&gt;");
    expect(nasty).toContain("?a=1&amp;b=2");
  });
});
