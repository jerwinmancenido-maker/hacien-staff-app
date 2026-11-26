import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BRAND_BLUE } from "@/lib/brand";
import { accountEmailHtml } from "@/lib/email-templates";
import { manilaYearStart } from "@/lib/format";
import { DEFAULT_SMS_SENDER_ID, smsSenderId } from "@/lib/messaging/providers";
import { taxYearStart } from "@/lib/services/non-vat";
import { DEFAULT_SETTINGS } from "@/lib/settings/defaults";
import { appIdentity, emailIdentity } from "@/lib/settings/identity";
import { newTotpSecret, totpCode, totpSetupUri, verifyTotpCode } from "@/lib/auth/totp";

/**
 * Company Profile slice 4 — emails & identity edges (census F10/F11/F7/
 * F13/F8/F15). Every derivation is pinned two ways: the seed profile
 * renders exactly the historical strings, and a dummy profile flows
 * through instead.
 */

const liveProfile = {
  ...DEFAULT_SETTINGS,
  company: {
    ...DEFAULT_SETTINGS.company,
    name: "HACIEN Information Technology Solutions",
    website: "haciensolutions.com",
  },
};

const dummyProfile = {
  ...DEFAULT_SETTINGS,
  company: { ...DEFAULT_SETTINGS.company, name: "ACME TEST CO", website: "acme.example" },
  identity: {
    ...DEFAULT_SETTINGS.identity,
    appTitle: "ACME Staff",
    appShortName: "ACME",
    smsSenderId: "ACME SMS",
  },
};

describe("emailIdentity (F10)", () => {
  it("with the live profile values renders the historical wordmark and footer byte-for-byte", () => {
    const id = emailIdentity(liveProfile);
    expect(id.wordmark).toBe("HACIEN");
    expect(id.shortName).toBe("HACIEN");
    expect(id.footerLine).toBe("HACIEN Information Technology Solutions · haciensolutions.com");
    expect(id.accentColor).toBe("#2563EB");
  });

  it("follows a dummy profile, and skips a blank website without a dangling separator", () => {
    const id = emailIdentity(dummyProfile);
    expect(id.wordmark).toBe("ACME");
    expect(id.footerLine).toBe("ACME TEST CO · acme.example");
    const noSite = emailIdentity({
      ...dummyProfile,
      company: { ...dummyProfile.company, website: "" },
    });
    expect(noSite.footerLine).toBe("ACME TEST CO");
  });

  it("account email HTML carries the dummy identity and no HACIEN strings", () => {
    const html = accountEmailHtml(
      {
        name: "Ana",
        heading: "Reset your password",
        intro: "Someone asked to reset your password.",
        buttonLabel: "Reset password",
        url: "https://example.com/reset?token=abc123",
        expiryLine: "This link works for 1 hour.",
        ignoreNote: "Ignore this email if it wasn't you.",
      },
      emailIdentity(dummyProfile),
    );
    expect(html).toContain(">ACME</span>");
    expect(html).toContain("ACME TEST CO · acme.example");
    expect(html).not.toContain("HACIEN");
    expect(html).not.toContain("haciensolutions");
  });
});

describe("app identity for layout + manifest (F7)", () => {
  it("seed profile composes exactly the historical title and description", () => {
    const id = appIdentity(DEFAULT_SETTINGS);
    expect(id.title).toBe("HACIEN Staff");
    expect(`${id.shortName} staff app`).toBe("HACIEN staff app");
  });

  it("dummy profile flows into title and description", () => {
    const id = appIdentity(dummyProfile);
    expect(id.title).toBe("ACME Staff");
    expect(`${id.shortName} staff app`).toBe("ACME staff app");
  });
});

describe("SMS sender default (F11)", () => {
  const saved = process.env.UNISMS_SENDER_ID;
  afterEach(() => {
    if (saved === undefined) delete process.env.UNISMS_SENDER_ID;
    else process.env.UNISMS_SENDER_ID = saved;
  });

  it("the seed default is the settings seed — one source", () => {
    expect(DEFAULT_SMS_SENDER_ID).toBe("Hacien ITS");
    expect(DEFAULT_SMS_SENDER_ID).toBe(DEFAULT_SETTINGS.identity.smsSenderId);
  });

  it("smsSenderId() (no-settings path): seed default, env override wins", () => {
    delete process.env.UNISMS_SENDER_ID;
    expect(smsSenderId()).toBe("Hacien ITS");
    process.env.UNISMS_SENDER_ID = "Custom Sender";
    expect(smsSenderId()).toBe("Custom Sender");
  });
});

describe("TOTP issuer (F13)", () => {
  it("the default enrollment URI is byte-identical to the historical one", () => {
    expect(totpSetupUri("JBSWY3DPEHPK3PXP", "staff@example.com")).toBe(
      "otpauth://totp/HACIEN:staff%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=HACIEN&algorithm=SHA1&digits=6&period=30",
    );
  });

  it("a dummy issuer flows into the label and issuer param", () => {
    const uri = totpSetupUri("JBSWY3DPEHPK3PXP", "staff@example.com", "ACME TEST CO");
    expect(uri).toContain("otpauth://totp/ACME%20TEST%20CO:staff%40example.com");
    expect(uri).toContain("issuer=ACME%20TEST%20CO");
  });

  it("verification never reads the issuer: a secret enrolled under the old issuer still verifies", () => {
    // Proof by construction + behaviour: verifyTotpCode takes (secret,
    // code) — there is no issuer input to couple to. Build enrollment
    // URIs under two issuers for the same secret; the code from that
    // secret verifies either way.
    const secret = newTotpSecret();
    const now = Math.floor(Date.now() / 1000);
    const oldUri = totpSetupUri(secret, "staff@example.com", "HACIEN");
    const newUri = totpSetupUri(secret, "staff@example.com", "ACME TEST CO");
    expect(oldUri).toContain("secret=" + secret);
    expect(newUri).toContain("secret=" + secret);
    expect(verifyTotpCode(secret, totpCode(secret, now), now)).toBe(true);
  });
});

describe("brand blue (F8)", () => {
  it("the TS constant and the CSS token are the same blue", () => {
    expect(BRAND_BLUE).toBe("#2563EB");
    const css = readFileSync(path.resolve(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).toContain("--blue: #2563eb");
    // The out-of-token literals are gone: print accents and the lot
    // badge go through the token now.
    expect(css).not.toContain("var(--blue, #2563eb)");
    expect(css).not.toContain("background: #2563eb");
  });
});

describe("Manila year start (F15)", () => {
  it("the Intl-derived start equals the old fixed UTC+8 math for every year the meter can see", () => {
    // Asia/Manila has been UTC+8 year-round throughout 2015–2040 in the
    // tz database, so delegating taxYearStart to format.ts changes no
    // result; this loop is the equivalence proof.
    for (let year = 2015; year <= 2040; year++) {
      const expected = Date.UTC(year, 0, 1) - 8 * 60 * 60 * 1000;
      expect(manilaYearStart(year).getTime(), `manilaYearStart ${year}`).toBe(expected);
      expect(taxYearStart(year).getTime(), `taxYearStart ${year}`).toBe(expected);
    }
    expect(taxYearStart(2026).toISOString()).toBe("2025-12-31T16:00:00.000Z");
  });
});
