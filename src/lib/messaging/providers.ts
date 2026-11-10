// Messaging providers (Q15, S-94).
// One send function per channel behind this interface, plain fetch.
// Nothing is sent until the CTO sets the keys: without them, the provider
// returns "not sent: not set up" and no request is made.
//
// UniSMS sender ID: env UNISMS_SENDER_ID, default "Hacien ITS" — the
// approved sender ID (owner-confirmed 2026-11-10).

export const DEFAULT_SMS_SENDER_ID = "Hacien ITS";

/** The sender ID every SMS goes out under. Read at send time. */
export function smsSenderId(): string {
  return process.env.UNISMS_SENDER_ID?.trim() || DEFAULT_SMS_SENDER_ID;
}

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
 * UniSMS provider, used only when the CTO has set both UNISMS_API_URL and
 * UNISMS_API_KEY. Request shape per the UniSMS docs (CTO-verified
 * 2026-11-10): POST the API URL exactly as given (it is set to
 * https://unismsapi.com/api/sms), Basic auth with the secret key as the
 * username and an empty password, JSON body {recipient, content, sender_id}.
 * Go-live stays gated on the UniSMS DPA + DB location checks.
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
          Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
        },
        body: JSON.stringify({ recipient: input.to, content: input.body, sender_id: smsSenderId() }),
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
