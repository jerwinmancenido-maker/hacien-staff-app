import { describe, expect, it } from "vitest";
import { amountInWords } from "@/lib/print/amount-in-words";

describe("amountInWords", () => {
  it("handles zero", () => {
    expect(amountInWords(0)).toBe("Zero pesos only");
    expect(amountInWords("0.00")).toBe("Zero pesos only");
  });

  it("handles whole pesos", () => {
    expect(amountInWords(1)).toBe("One peso only");
    expect(amountInWords(20_000)).toBe("Twenty thousand pesos only");
    expect(amountInWords("520000.00")).toBe("Five hundred twenty thousand pesos only");
  });

  it("handles centavos as and NN/100", () => {
    expect(amountInWords(20_000.5)).toBe("Twenty thousand pesos and 50/100");
    expect(amountInWords("100.05")).toBe("One hundred pesos and 05/100");
    expect(amountInWords("0.99")).toBe("Zero pesos and 99/100");
  });

  it("handles large numbers like millions", () => {
    expect(amountInWords(1_000_000)).toBe("One million pesos only");
    expect(amountInWords(12_345_678.9)).toBe("Twelve million three hundred forty-five thousand six hundred seventy-eight pesos and 90/100");
  });

  it("handles negative amounts", () => {
    expect(amountInWords(-50)).toBe("Negative fifty pesos only");
  });
});
