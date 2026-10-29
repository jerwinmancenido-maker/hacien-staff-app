// Pluggable mailer. With SMTP_HOST set, mail goes out over SMTP (nodemailer).
// Without it, in development, the message (including links) is logged to the console.

import nodemailer from "nodemailer";

export type Mail = { to: string; subject: string; text: string };

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

export const consoleMailer: Mailer = {
  async send(mail) {
    console.info(`\n[mail] To: ${mail.to}\n[mail] Subject: ${mail.subject}\n${mail.text}\n`);
  },
};

function smtpMailer(): Mailer {
  const port = Number(process.env.SMTP_PORT || 587);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return {
    async send(mail) {
      await transport.sendMail({ from: process.env.MAIL_FROM, ...mail });
    },
  };
}

let override: Mailer | null = null;

/** For tests. */
export function setMailer(m: Mailer | null) {
  override = m;
}

export function getMailer(): Mailer {
  if (override) return override;
  if (process.env.SMTP_HOST) return smtpMailer();
  if (process.env.NODE_ENV === "production") {
    // Never write reset links to production logs.
    return {
      async send(mail) {
        console.error(`[mail] SMTP_HOST is not set; could not send "${mail.subject}" to ${mail.to}.`);
      },
    };
  }
  return consoleMailer;
}

export function appUrl(path: string): string {
  const base = (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
  return `${base}${path}`;
}
