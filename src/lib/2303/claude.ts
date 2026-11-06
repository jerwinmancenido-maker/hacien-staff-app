// BIR 2303 structuring with Claude (step 2): turn the extracted text into
// form fields + a confidence per field. Server-side only — the Anthropic
// key never leaves the server, and a missing key means no auto-fill (the
// extracted text is still shown; staff types manually). Direct fetch, no
// SDK package: the call is one POST with a fixed prompt and a strict
// JSON shape, and the repo rule is no new dependencies unless the brief
// says so.
import { z } from "zod";
import { normalizeTin } from "@/lib/validation/tin";

/** Pinned Haiku snapshot (Oct 2025): the alias moves, the dated id doesn't. */
export const CLAUDE_MODEL = "claude-haiku-4-5-20251001";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const CLAUDE_TIMEOUT_MS = 30_000;

export type FieldConfidence = "high" | "medium" | "low";
export type Parsed2303Field = { value: string | null; confidence: FieldConfidence };
export type Structured2303 = {
  registeredName: Parsed2303Field;
  tin: Parsed2303Field;
  /** Branch code as printed on the 2303, e.g. "000". Folded into tin. */
  branchCode: Parsed2303Field;
  registeredAddress: Parsed2303Field;
  tradeName: Parsed2303Field;
  rdo: Parsed2303Field;
  dateRegistered: Parsed2303Field;
};
export type StructureUsage = { inputTokens: number; outputTokens: number };
export type StructureResult = { fields: Structured2303; usage: StructureUsage };

const fieldSchema = z.object({
  value: z.string().nullable(),
  confidence: z.enum(["high", "medium", "low"]),
});
const structuredSchema = z.object({
  registeredName: fieldSchema,
  tin: fieldSchema,
  branchCode: fieldSchema,
  registeredAddress: fieldSchema,
  tradeName: fieldSchema,
  rdo: fieldSchema,
  dateRegistered: fieldSchema,
});

const PROMPT = `You read the text of a Philippine BIR Certificate of Registration (Form 2303). Return ONLY a JSON object, no markdown fences, no other text, with exactly these fields. Each field is {"value": string or null, "confidence": "high" | "medium" | "low"}.
- registeredName: the registered name of the taxpayer.
- tin: the Tax Identification Number, digits and dashes as printed (9 digits; do not add a branch code here).
- branchCode: the branch code printed with the TIN, if any (usually "000"); null when the certificate shows none.
- registeredAddress: the registered address as one full string.
- tradeName: the trade name, but ONLY when it is different from the registered name; null when it matches or is absent.
- rdo: the Revenue District Office number (e.g. "043"); null when absent.
- dateRegistered: the date registered, exactly as printed; null when absent.
Confidence: "high" when the text states it plainly, "medium" when it is readable but partly unclear, "low" when you are guessing or inferring it. Use null, not a guess, when a field is not on the certificate.
Text:
`;

function stripFences(text: string): string {
  const t = text.trim();
  if (!t.startsWith("```")) return t;
  return t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

/** The key, if set. Empty string counts as unset. */
export function getAnthropicKey(): string | undefined {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  return key ? key : undefined;
}

/**
 * Structure extracted 2303 text with Claude. Throws a staff-safe error
 * when the call fails or the answer can't be used — the caller falls back
 * to manual entry and never blocks the form.
 */
export async function structure2303Text(
  text: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StructureResult> {
  if (!text.trim()) throw new Error("No text to structure.");
  let res: Response;
  try {
    res = await fetchImpl(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 1024,
        messages: [{ role: "user", content: PROMPT + text }],
      }),
      signal: AbortSignal.timeout(CLAUDE_TIMEOUT_MS),
    });
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") {
      throw new Error("Auto-fill took too long. Type the details manually.");
    }
    throw new Error("Auto-fill could not reach Claude. Type the details manually.");
  }
  if (!res.ok) {
    throw new Error(`Auto-fill didn't work for this file (Claude answered ${res.status}). Type the details manually.`);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error("Auto-fill gave an answer we couldn't use. Type the details manually.");
  }
  const content = (body as { content?: unknown })?.content;
  const textBlock = Array.isArray(content)
    ? content.find((b): b is { type: "text"; text: string } => typeof b === "object" && b !== null && (b as { type?: unknown }).type === "text" && typeof (b as { text?: unknown }).text === "string")
    : undefined;
  if (!textBlock) throw new Error("Auto-fill gave an answer we couldn't use. Type the details manually.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(textBlock.text));
  } catch {
    throw new Error("Auto-fill gave an answer we couldn't use. Type the details manually.");
  }
  const fields = structuredSchema.parse(parsed);
  const usageRaw = (body as { usage?: { input_tokens?: unknown; output_tokens?: unknown } })?.usage;
  const usage: StructureUsage = {
    inputTokens: typeof usageRaw?.input_tokens === "number" ? usageRaw.input_tokens : 0,
    outputTokens: typeof usageRaw?.output_tokens === "number" ? usageRaw.output_tokens : 0,
  };
  // Fold the branch code into the TIN in the stored 000-000-000-000
  // format. A TIN that doesn't fit the shape is never auto-filled: its
  // confidence drops to low so the field stays blank for staff to type.
  const tin = fields.tin.value?.trim() ?? null;
  if (tin) {
    const branch = fields.branchCode.value?.trim() ?? "";
    const combined = branch && !/-\d{3}$|-\d{5}$/.test(tin) ? `${tin}-${branch}` : tin;
    const normalized = normalizeTin(combined);
    if (normalized === "invalid") {
      fields.tin = { value: tin, confidence: "low" };
    } else if (normalized) {
      fields.tin = { value: normalized, confidence: fields.tin.confidence };
    }
  }
  return { fields, usage };
}
