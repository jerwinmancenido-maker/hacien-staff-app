// REQ-SMS-SENDER-001: the UniSMS request shape, pinned exactly — URL as
// given, Basic auth (secret key as username, empty password), JSON body
// {recipient, content, sender_id}; sender defaults to the approved
// "Hacien ITS" and UNISMS_SENDER_ID overrides it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchProvider } from "@/lib/messaging/providers";

const URL = "https://unismsapi.com/api/sms";
const KEY = "test-secret-key";

function captureFetch() {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => "" } as Response;
  });
  return { calls, fn: fn as unknown as typeof fetch };
}

afterEach(() => {
  delete process.env.UNISMS_SENDER_ID;
});

describe("UniSMS fetch provider", () => {
  it("sends the exact UniSMS request with the default sender ID", async () => {
    const { calls, fn } = captureFetch();
    const provider = fetchProvider("UniSMS", URL, KEY, fn);
    const result = await provider.send({ to: "+639171234567", body: "Hello from HACIEN" });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(URL);
    expect(calls[0]!.init.method).toBe("POST");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from(`${KEY}:`).toString("base64")}`);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      recipient: "+639171234567",
      content: "Hello from HACIEN",
      sender_id: "Hacien ITS",
    });
  });

  it("uses UNISMS_SENDER_ID when set", async () => {
    process.env.UNISMS_SENDER_ID = "Custom Sender";
    const { calls, fn } = captureFetch();
    const provider = fetchProvider("UniSMS", URL, KEY, fn);
    await provider.send({ to: "+639171234567", body: "Hi" });
    expect(JSON.parse(String(calls[0]!.init.body)).sender_id).toBe("Custom Sender");
  });
});
