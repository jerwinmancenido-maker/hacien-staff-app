// Claude 2303 structuring (step 2): the Anthropic call is mocked —
// tests never hit the real API and never need a real key.
import { describe, expect, it, vi } from "vitest";
import { CLAUDE_MODEL, structure2303Text } from "@/lib/2303/claude";

const TEXT =
  "REPUBLIC OF THE PHILIPPINES\nBIR 2303\nRegistered Name: HACIEN INFORMATION TECHNOLOGY SOLUTIONS\nTIN: 123-456-789-000\nRegistered Address: 123 Main Street, Pasig City\nRDO: 043\nDate Registered: November 3, 2026";

function claudeReply(fields: Record<string, { value: string | null; confidence: string }>, usage = { input_tokens: 1200, output_tokens: 210 }) {
  return {
    content: [{ type: "text", text: JSON.stringify(fields) }],
    usage,
  };
}

const baseFields = {
  registeredName: { value: "HACIEN INFORMATION TECHNOLOGY SOLUTIONS", confidence: "high" },
  tin: { value: "123-456-789", confidence: "high" },
  branchCode: { value: "000", confidence: "high" },
  registeredAddress: { value: "123 Main Street, Pasig City", confidence: "high" },
  tradeName: { value: null, confidence: "high" },
  rdo: { value: "043", confidence: "high" },
  dateRegistered: { value: "November 3, 2026", confidence: "medium" },
};

function stubFetch(reply: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(reply), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("structure2303Text", () => {
  it("structures the text and folds the branch code into the TIN", async () => {
    const { fetchImpl, calls } = stubFetch(claudeReply(baseFields));
    const { fields, usage } = await structure2303Text(TEXT, "sk-test", fetchImpl);
    expect(fields.registeredName.value).toBe("HACIEN INFORMATION TECHNOLOGY SOLUTIONS");
    expect(fields.tin.value).toBe("123-456-789-000");
    expect(fields.tin.confidence).toBe("high");
    expect(fields.registeredAddress.value).toBe("123 Main Street, Pasig City");
    expect(fields.rdo.value).toBe("043");
    expect(fields.dateRegistered.confidence).toBe("medium");
    expect(usage).toEqual({ inputTokens: 1200, outputTokens: 210 });
    const sent = JSON.parse(String(calls[0]!.init.body));
    expect(sent.model).toBe(CLAUDE_MODEL);
    expect(sent.messages[0].content).toContain("HACIEN INFORMATION TECHNOLOGY SOLUTIONS");
    expect(calls[0]!.url).toBe("https://api.anthropic.com/v1/messages");
  });

  it("parses a fenced ```json answer", async () => {
    const fenced = "```json\n" + JSON.stringify(baseFields) + "\n```";
    const { fetchImpl } = stubFetch({ content: [{ type: "text", text: fenced }], usage: { input_tokens: 1, output_tokens: 1 } });
    const { fields } = await structure2303Text(TEXT, "sk-test", fetchImpl);
    expect(fields.tin.value).toBe("123-456-789-000");
  });

  it("leaves a TIN that is already complete alone", async () => {
    const { fetchImpl } = stubFetch(claudeReply({ ...baseFields, tin: { value: "123-456-789-000", confidence: "high" } }));
    const { fields } = await structure2303Text(TEXT, "sk-test", fetchImpl);
    expect(fields.tin.value).toBe("123-456-789-000");
  });

  it("downgrades a bad-shape TIN to low confidence instead of filling it", async () => {
    const { fetchImpl } = stubFetch(claudeReply({ ...baseFields, tin: { value: "ABC-123", confidence: "high" }, branchCode: { value: null, confidence: "high" } }));
    const { fields } = await structure2303Text(TEXT, "sk-test", fetchImpl);
    expect(fields.tin.confidence).toBe("low");
  });

  it("rejects an answer that is not JSON", async () => {
    const { fetchImpl } = stubFetch({ content: [{ type: "text", text: "not json at all" }], usage: {} });
    await expect(structure2303Text(TEXT, "sk-test", fetchImpl)).rejects.toThrow(/couldn't use/);
  });

  it("rejects a non-200 answer from Claude", async () => {
    const { fetchImpl } = stubFetch({ error: { message: "bad key" } }, 401);
    await expect(structure2303Text(TEXT, "sk-test", fetchImpl)).rejects.toThrow(/401/);
  });

  it("rejects empty text", async () => {
    const { fetchImpl } = stubFetch(claudeReply(baseFields));
    await expect(structure2303Text("   ", "sk-test", fetchImpl)).rejects.toThrow(/No text/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps a 5-digit branch code in the TIN", async () => {
    const { fetchImpl } = stubFetch(
      claudeReply({ ...baseFields, tin: { value: "328-671-896", confidence: "high" }, branchCode: { value: "00001", confidence: "high" } }),
    );
    const { fields } = await structure2303Text(TEXT, "sk-test", fetchImpl);
    expect(fields.tin.value).toBe("328-671-896-00001");
    expect(fields.tin.confidence).toBe("high");
  });

  it("repairs a branch split across the TIN and the branch code", async () => {
    // Claude read the 5-digit branch "00001" as tin=...-000 + branch="01".
    // The digits still add up to the full TIN — nothing is dropped.
    const { fetchImpl } = stubFetch(
      claudeReply({ ...baseFields, tin: { value: "328-671-896-000", confidence: "high" }, branchCode: { value: "01", confidence: "high" } }),
    );
    const { fields } = await structure2303Text(TEXT, "sk-test", fetchImpl);
    expect(fields.tin.value).toBe("328-671-896-00001");
  });

  it("uses the head-office 000 when no branch is on the certificate", async () => {
    const { fetchImpl } = stubFetch(
      claudeReply({ ...baseFields, tin: { value: "328-671-896", confidence: "high" }, branchCode: { value: null, confidence: "high" } }),
    );
    const { fields } = await structure2303Text(TEXT, "sk-test", fetchImpl);
    expect(fields.tin.value).toBe("328-671-896-000");
  });

  it("downgrades a TIN whose digits cannot make a 9+3 or 9+5 shape", async () => {
    // 9 digits + a 2-digit branch code adds up to 11 — not a real shape.
    const { fetchImpl } = stubFetch(
      claudeReply({ ...baseFields, tin: { value: "328-671-896", confidence: "high" }, branchCode: { value: "01", confidence: "high" } }),
    );
    const { fields } = await structure2303Text(TEXT, "sk-test", fetchImpl);
    expect(fields.tin.confidence).toBe("low");
  });

  it("returns the split address parts when Claude provides them", async () => {
    const { fetchImpl } = stubFetch(
      claudeReply({
        ...baseFields,
        registeredAddress: { value: "Unit 7B, Sample Heights Tower, 88 Sampaguita Avenue, San Roque, Marikina City, Metro Manila 1801", confidence: "high" },
        addressStreet: { value: "Unit 7B, Sample Heights Tower, 88 Sampaguita Avenue", confidence: "high" },
        addressBarangay: { value: "San Roque", confidence: "high" },
        addressCity: { value: "Marikina", confidence: "high" },
        addressProvince: { value: "Metro Manila", confidence: "high" },
        addressZip: { value: "1801", confidence: "high" },
      }),
    );
    const { fields } = await structure2303Text(TEXT, "sk-test", fetchImpl);
    expect(fields.addressStreet.value).toBe("Unit 7B, Sample Heights Tower, 88 Sampaguita Avenue");
    expect(fields.addressBarangay.value).toBe("San Roque");
    expect(fields.addressCity.value).toBe("Marikina");
    expect(fields.addressProvince.value).toBe("Metro Manila");
    expect(fields.addressZip.value).toBe("1801");
  });

  it("defaults missing address parts to null when the answer is in the old shape", async () => {
    const { fetchImpl } = stubFetch(claudeReply(baseFields));
    const { fields } = await structure2303Text(TEXT, "sk-test", fetchImpl);
    expect(fields.registeredAddress.value).toBe("123 Main Street, Pasig City");
    expect(fields.addressStreet.value).toBeNull();
    expect(fields.addressBarangay.value).toBeNull();
    expect(fields.addressCity.value).toBeNull();
    expect(fields.addressProvince.value).toBeNull();
    expect(fields.addressZip.value).toBeNull();
  });
});
