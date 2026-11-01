// Convert a peso amount to English words for print footers.
// Examples: 20000 → "Twenty Thousand Pesos Only"
//           20000.50 → "Twenty Thousand Pesos and 50/100"
//           0 → "Zero Pesos Only"
// Title-case every word except "and" (BIR / receipt style).

const ONES = [
  "",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
] as const;

const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"] as const;

const SCALES = [
  { value: 1_000_000_000, name: "billion" },
  { value: 1_000_000, name: "million" },
  { value: 1_000, name: "thousand" },
] as const;

function underThousand(n: number): string {
  if (n < 20) return ONES[n]!;
  if (n < 100) {
    const t = TENS[Math.floor(n / 10)]!;
    const o = ONES[n % 10]!;
    return o ? `${t}-${o}` : t;
  }
  const h = ONES[Math.floor(n / 100)]!;
  const rest = n % 100;
  return rest ? `${h} hundred ${underThousand(rest)}` : `${h} hundred`;
}

function integerWords(n: number): string {
  if (n === 0) return "zero";
  const parts: string[] = [];
  let remaining = n;
  for (const { value, name } of SCALES) {
    if (remaining >= value) {
      const chunk = Math.floor(remaining / value);
      parts.push(`${underThousand(chunk)} ${name}`);
      remaining %= value;
    }
  }
  if (remaining > 0) parts.push(underThousand(remaining));
  return parts.join(" ");
}

/** Title-case words; keep "and" lowercase; capitalize each hyphen segment (Eighty-One). */
function titleCasePhrase(s: string): string {
  return s
    .split(" ")
    .map((word) => {
      if (word === "and") return word;
      return word
        .split("-")
        .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : part))
        .join("-");
    })
    .join(" ");
}

/** Parse money to integer centavos without binary float drift. */
function toCentavos(amount: number | string): number {
  if (typeof amount === "number") {
    if (!Number.isFinite(amount)) return 0;
    const sign = amount < 0 ? -1 : 1;
    const abs = Math.abs(amount);
    const whole = Math.floor(abs);
    // Pull fractional part from a fixed 2-dp string to avoid 0.5*100 drift.
    const frac = Math.round(Number((abs - whole).toFixed(2)) * 100);
    return sign * (whole * 100 + frac);
  }
  const cleaned = String(amount).replace(/,/g, "").trim();
  const m = cleaned.match(/^(-?)(\d+)(?:\.(\d{0,2})\d*)?$/);
  if (!m) {
    const n = Number(cleaned);
    return Number.isFinite(n) ? toCentavos(n) : 0;
  }
  const sign = m[1] === "-" ? -1 : 1;
  const pesos = Number(m[2] || "0");
  const cents = Number((m[3] || "0").padEnd(2, "0").slice(0, 2));
  return sign * (pesos * 100 + cents);
}

/**
 * Amount in words for Philippine peso documents.
 * Accepts number or money string ("20000.50"). Negative amounts are prefixed with "Negative".
 */
export function amountInWords(amount: number | string): string {
  const centsTotal = toCentavos(amount);
  const negative = centsTotal < 0;
  const abs = Math.abs(centsTotal);
  const pesos = Math.floor(abs / 100);
  const centavos = abs % 100;

  const pesoWord = pesos === 1 ? "Peso" : "Pesos";
  const pesoPart = `${titleCasePhrase(integerWords(pesos))} ${pesoWord}`;
  let phrase: string;
  if (centavos === 0) {
    phrase = `${pesoPart} Only`;
  } else {
    const frac = String(centavos).padStart(2, "0");
    phrase = `${pesoPart} and ${frac}/100`;
  }
  return negative ? `Negative ${phrase}` : phrase;
}
