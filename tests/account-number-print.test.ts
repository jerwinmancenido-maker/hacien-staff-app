import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProfessionalPrintDocument } from "@/components/docs/ProfessionalPrintDocument";
import {
  accountNumberForPrint,
  maskAccountLast4,
  redactPrintAccountNumbers,
} from "@/lib/print/account-number";
import { paymentInstructionsFromSettings } from "@/lib/print/company";
import { DEFAULT_SETTINGS } from "@/lib/settings/defaults";
import { quotePrintFixture } from "./fixtures/print-doc";

describe("print full account number toggle", () => {
  it("defaults OFF — print settings banks/eWallets start empty and helper masks last 4", () => {
    expect(DEFAULT_SETTINGS.print.banks).toEqual([]);
    expect(DEFAULT_SETTINGS.print.eWallets).toEqual([]);
    expect(maskAccountLast4("4321")).toBe("****4321");
    expect(
      accountNumberForPrint({
        accountLast4: "4321",
        printFullAccountNumber: false,
        accountNumberFull: "1234-5678-9012-4321",
      }),
    ).toBe("****4321");
  });

  it("prints the full number only when the toggle is ON and a full number was entered", () => {
    // Obviously fake test number — never a real account.
    const fakeFull = "0000-1111-2222-9999";
    expect(
      accountNumberForPrint({
        accountLast4: "9999",
        printFullAccountNumber: true,
        accountNumberFull: fakeFull,
      }),
    ).toBe(fakeFull);
    expect(
      accountNumberForPrint({
        accountLast4: "9999",
        printFullAccountNumber: true,
        accountNumberFull: "",
      }),
    ).toBe("****9999");
  });

  it("builds payment instructions with last-4 by default from settings", () => {
    const instructions = paymentInstructionsFromSettings({
      ...DEFAULT_SETTINGS.print,
      banks: [
        {
          bankName: "Sample Bank",
          accountName: "HACIEN Sample",
          accountLast4: "4321",
          printFullAccountNumber: false,
          accountNumberFull: "",
        },
      ],
      eWallets: [
        {
          provider: "GCash",
          accountName: "HACIEN Sample",
          accountLast4: "9876",
          printFullAccountNumber: true,
          accountNumberFull: "0917-000-9876",
        },
      ],
    });
    expect(instructions[0]!.accountPrinted).toBe("****4321");
    expect(instructions[1]!.accountPrinted).toBe("0917-000-9876");
  });

  it("never puts a full account number into render snapshots / fixtures", () => {
    const markup = renderToStaticMarkup(createElement(ProfessionalPrintDocument, { doc: quotePrintFixture() }));
    expect(markup).toContain("****1234");
    expect(markup).not.toContain("0000-1111");
    // Snapshot fixtures only carry the masked form.
    expect(JSON.stringify(quotePrintFixture().paymentInstructions)).not.toMatch(/\d{5,}/);
  });

  it("redacts full account numbers from changelog before/after payloads", () => {
    const fakeFull = "0000-1111-2222-9999";
    const redacted = redactPrintAccountNumbers({
      paperSize: "A4",
      showInputTaxDisclaimer: true,
      quoteTerms: "",
      deliveryNotes: "",
      warrantyNotes: "",
      banks: [
        {
          bankName: "Sample Bank",
          accountName: "HACIEN",
          accountLast4: "9999",
          printFullAccountNumber: true,
          accountNumberFull: fakeFull,
        },
      ],
      eWallets: [],
    });
    expect(redacted.banks[0]!.accountNumberFull).toBe("[redacted]");
    expect(JSON.stringify(redacted)).not.toContain(fakeFull);
  });
});
