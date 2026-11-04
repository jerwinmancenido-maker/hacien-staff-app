// Send one message per channel (Q15, S-94).
// Every attempt is written to MessageLog. The log page only ever renders the
// masked recipient; the normalized recipient is stored so retry can resend.
// Callers inject a provider and a log writer in tests; production uses the
// configured provider and Prisma.

import type { MessageChannel, MessageStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { isValidEmail, normalizePhMobile } from "./phone";
import { getEmailProvider, getSmsProvider, type MessageProvider } from "./providers";

export type SendInput = {
  channel: MessageChannel;
  /** PH mobile for sms, email address for email. */
  to: string;
  body: string;
  sentById?: string;
};

export type SendResult =
  | { ok: true; status: "sent"; logId: string }
  | { ok: false; status: "not_sent" | "failed"; error: string; logId: string };

export type LogWriter = {
  create(data: {
    channel: MessageChannel;
    recipient: string;
    body: string;
    status: MessageStatus;
    provider: string;
    providerMessageId?: string;
    error?: string;
    sentById?: string;
  }): Promise<{ id: string }>;
  update(
    id: string,
    data: { status: MessageStatus; providerMessageId?: string; error?: string; attempts: number },
  ): Promise<unknown>;
  find(id: string): Promise<{
    id: string;
    channel: MessageChannel;
    recipient: string;
    body: string;
    attempts: number;
  } | null>;
};

export const prismaLogWriter: LogWriter = {
  async create(data) {
    const row = await db.messageLog.create({
      data: {
        channel: data.channel,
        recipient: data.recipient,
        body: data.body,
        status: data.status,
        provider: data.provider,
        providerMessageId: data.providerMessageId,
        error: data.error,
        sentById: data.sentById,
      },
    });
    return { id: row.id };
  },
  async update(id, data) {
    return db.messageLog.update({
      where: { id },
      data: {
        status: data.status,
        providerMessageId: data.providerMessageId,
        error: data.error,
        attempts: data.attempts,
        lastAttemptAt: new Date(),
      },
    });
  },
  async find(id) {
    const row = await db.messageLog.findUnique({ where: { id } });
    if (!row) return null;
    return { id: row.id, channel: row.channel, recipient: row.recipient, body: row.body, attempts: row.attempts };
  },
};

function providerFor(channel: MessageChannel): MessageProvider {
  return channel === "sms" ? getSmsProvider() : getEmailProvider();
}

/** Validate, send through the channel provider, log the attempt. */
export async function sendMessage(
  input: SendInput,
  deps: { provider?: MessageProvider; log?: LogWriter } = {},
): Promise<SendResult> {
  const log = deps.log ?? prismaLogWriter;
  const body = input.body.trim();
  if (!body) {
    const row = await log.create({
      channel: input.channel,
      recipient: input.to,
      body: input.body,
      status: "failed",
      provider: providerFor(input.channel).name,
      error: "Message body is empty.",
      sentById: input.sentById,
    });
    return { ok: false, status: "failed", error: "Message body is empty.", logId: row.id };
  }
  let recipient = input.to.trim();
  if (input.channel === "sms") {
    const normalized = normalizePhMobile(recipient);
    if (!normalized) {
      const row = await log.create({
        channel: "sms",
        recipient: input.to,
        body,
        status: "failed",
        provider: providerFor("sms").name,
        error: "Not a valid Philippine mobile number.",
        sentById: input.sentById,
      });
      return { ok: false, status: "failed", error: "Not a valid Philippine mobile number.", logId: row.id };
    }
    recipient = normalized;
  } else if (!isValidEmail(recipient)) {
    const row = await log.create({
      channel: "email",
      recipient: input.to,
      body,
      status: "failed",
      provider: providerFor("email").name,
      error: "Not a valid email address.",
      sentById: input.sentById,
    });
    return { ok: false, status: "failed", error: "Not a valid email address.", logId: row.id };
  }

  const provider = deps.provider ?? providerFor(input.channel);
  let result;
  try {
    result = await provider.send({ to: recipient, body });
  } catch (e) {
    result = { ok: false as const, error: e instanceof Error ? e.message : "Send failed." };
  }
  if (result.ok) {
    const row = await log.create({
      channel: input.channel,
      recipient,
      body,
      status: "sent",
      provider: provider.name,
      providerMessageId: result.providerMessageId,
      sentById: input.sentById,
    });
    return { ok: true, status: "sent", logId: row.id };
  }
  const status: MessageStatus = result.error === "not sent: not set up" ? "not_sent" : "failed";
  const row = await log.create({
    channel: input.channel,
    recipient,
    body,
    status,
    provider: provider.name,
    error: result.error,
    sentById: input.sentById,
  });
  return { ok: false, status, error: result.error, logId: row.id };
}

/** Retry a logged message: resend the same body to the same recipient. */
export async function retryMessage(
  logId: string,
  deps: { provider?: MessageProvider; log?: LogWriter } = {},
): Promise<SendResult> {
  const log = deps.log ?? prismaLogWriter;
  const row = await log.find(logId);
  if (!row) {
    return { ok: false, status: "failed", error: "Message log not found.", logId };
  }
  const provider = deps.provider ?? providerFor(row.channel);
  let result;
  try {
    result = await provider.send({ to: row.recipient, body: row.body });
  } catch (e) {
    result = { ok: false as const, error: e instanceof Error ? e.message : "Send failed." };
  }
  if (result.ok) {
    await log.update(logId, { status: "sent", providerMessageId: result.providerMessageId, attempts: row.attempts + 1 });
    return { ok: true, status: "sent", logId };
  }
  const status: MessageStatus = result.error === "not sent: not set up" ? "not_sent" : "failed";
  await log.update(logId, { status, error: result.error, attempts: row.attempts + 1 });
  return { ok: false, status, error: result.error, logId };
}
