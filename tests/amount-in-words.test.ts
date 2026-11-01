import { describe, expect, it } from "vitest";
import { amountInWords } from "@/lib/print/amount-in-words";

describe("amountInWords", () => {
  it("zero", () => {
    expect(amountInWords(0)).toBe("Zero Pesos Only");
    expect(amountInWords("0.00")).toBe("Zero Pesos Only");
  });

  it("whole pesos", () => {
    expect(amountInWords(1)).toBe("One Peso Only");
    expect(amountInWords(20_000)).toBe("Twenty Thousand Pesos Only");
    expect(amountInWords("520000.00")).toBe("Five Hundred Twenty Thousand Pesos Only");
  });

  it("centavos", () => {
    expect(amountInWords(20_000.5)).toBe("Twenty Thousand Pesos and 50/100");
    expect(amountInWords("100.05")).toBe("One Hundred Pesos and 05/100");
    expect(amountInWords("0.99")).toBe("Zero Pesos and 99/100");
    expect(amountInWords("0.01")).toBe("Zero Pesos and 01/100");
    expect(amountInWords("81500.75")).toBe("Eighty-One Thousand Five Hundred Pesos and 75/100");
  });

  it("millions", () => {
    expect(amountInWords(1_000_000)).toBe("One Million Pesos Only");
    expect(amountInWords("1000000.00")).toBe("One Million Pesos Only");
    expect(amountInWords(12_345_678.9)).toBe(
      "Twelve Million Three Hundred Forty-Five Thousand Six Hundred Seventy-Eight Pesos and 90/100",
    );
  });

  it("negatives", () => {
    expect(amountInWords(-50)).toBe("Negative Fifty Pesos Only");
  });
});
