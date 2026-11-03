// Messaging providers (Q15, S-94).
// One send function per channel behind this interface, plain fetch.
// Nothing is sent until the CTO sets the keys: without them, the provider
// returns "not sent: not set up" and no request is made.
//
// Sender ID is always HACIEN, for HACIEN only.

export const MESSAGING_SENDER = "HACIEN";

/** Exact reason logged when a channel is not configured. */
export const NOT_SET_UP = "not sent: not set up";

export type MessageProviderResult =
  | { ok: true; providerMessageId?: string }
  | { ok: false; error: string };

export interface MessageProvider {
  name: string;
  send(input: { to: string; body: string }): Promise<MessageProviderResult>;
}

export function notConfiguredProvider(name: string): MessageProvider {
  return {
    name,
    async send() {
      return { ok: false, error: NOT_SET_UP };
    },
  };
}

/**
 * Generic fetch provider, used only when the CTO has set both an API URL and
 * an API key for the channel. Needs owner check: the request format below is
 * a generic JSON payload, not a format verified against UniSMS or Hostinger
 * Reach docs — confirm it before go-live. Go-live is in any case blocked
 * until the UniSMS DPA, DB location, and HACIEN sender ID are in place.
 */
export function fetchProvider(
  name: string,
  apiUrl: string,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): MessageProvider {
  return {
    name,
    async send(input) {
      const res = await fetchFn(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ to: input.to, from: MESSAGING_SENDER, message: input.body }),
      });
      if (!res.ok) {
        let detail = "";
        try {
          detail = await res.text();
        } catch {
          detail = "";
        }
        return { ok: false, error: `Provider returned ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}` };
      }
      return { ok: true };
    },
  };
}

let smsOverride: MessageProvider | null = null;
let emailOverride: MessageProvider | null = null;

/** For tests. */
export function setSmsProvider(p: MessageProvider | null) {
  smsOverride = p;
}
/** For tests. */
export function setEmailProvider(p: MessageProvider | null) {
  emailOverride = p;
}

export function getSmsProvider(): MessageProvider {
  if (smsOverride) return smsOverride;
  const url = process.env.UNISMS_API_URL;
  const key = process.env.UNISMS_API_KEY;
  if (!url || !key) return notConfiguredProvider("UniSMS");
  return fetchProvider("UniSMS", url, key);
}

export function getEmailProvider(): MessageProvider {
  if (emailOverride) return emailOverride;
  // Email goes through the existing mailer when SMTP is set; otherwise it is
  // not set up. The mailer itself logs in development and refuses in production.
  if (!process.env.SMTP_HOST) return notConfiguredProvider("smtp");
  return {
    name: "smtp",
    async send(input) {
      const { getMailer } = await import("@/lib/mailer");
      await getMailer().send({ to: input.to, subject: "HACIEN update", text: input.body });
      return { ok: true };
    },
  };
}
