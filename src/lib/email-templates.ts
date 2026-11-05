// HTML emails for the staff app: one shared layout, no images, inline CSS
// only (mail clients strip stylesheets and often block images). Brand is the
// app's own: black/white with one blue accent #2563EB. The plain-text version
// is always sent alongside, so the message still reads in clients that block
// HTML. All interpolated values are escaped — names come from the database.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type AccountEmail = {
  name: string;
  heading: string;
  intro: string;
  buttonLabel: string;
  url: string;
  expiryLine: string;
  ignoreNote: string;
};

export function accountEmailHtml(e: AccountEmail): string {
  const name = escapeHtml(e.name);
  const heading = escapeHtml(e.heading);
  const intro = escapeHtml(e.intro);
  const buttonLabel = escapeHtml(e.buttonLabel);
  const url = escapeHtml(e.url);
  const expiryLine = escapeHtml(e.expiryLine);
  const ignoreNote = escapeHtml(e.ignoreNote);
  return (
    `<!doctype html><html><head><meta charset="utf-8"><title>${heading}</title></head>` +
    `<body style="margin:0;padding:0;background:#f2f2f2;font-family:Arial,Helvetica,sans-serif;color:#111111;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f2;">` +
    `<tr><td align="center" style="padding:40px 16px;">` +
    `<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:#ffffff;border:1px solid #e5e5e5;border-radius:8px;overflow:hidden;">` +
    `<tr><td style="background:#111111;padding:20px 32px;">` +
    `<span style="font-size:20px;font-weight:bold;letter-spacing:2px;color:#ffffff;">HACIEN</span>` +
    `<span style="font-size:12px;letter-spacing:2px;color:#cccccc;"> &nbsp;STAFF APP</span>` +
    `</td></tr>` +
    `<tr><td style="padding:32px;">` +
    `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;">${heading}</h1>` +
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Hi ${name},</p>` +
    `<p style="margin:0 0 28px;font-size:15px;line-height:1.6;">${intro}</p>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 28px;"><tr><td align="center" bgcolor="#2563EB" style="background:#2563EB;border-radius:6px;"><a href="${url}" style="display:inline-block;padding:14px 32px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;">${buttonLabel}</a></td></tr></table>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f7f7;border-radius:6px;">` +
    `<tr><td style="padding:14px 16px;">` +
    `<p style="margin:0 0 6px;font-size:13px;color:#666666;">Button not working? Copy this link into your browser:</p>` +
    `<p style="margin:0;font-size:13px;word-break:break-all;"><a href="${url}" style="color:#2563EB;">${url}</a></p>` +
    `</td></tr></table>` +
    `<p style="margin:24px 0 8px;font-size:13px;color:#666666;">${expiryLine}</p>` +
    `<p style="margin:0;font-size:13px;color:#666666;">${ignoreNote}</p>` +
    `</td></tr>` +
    `<tr><td style="padding:20px 32px;border-top:1px solid #eeeeee;">` +
    `<p style="margin:0 0 4px;font-size:12px;color:#999999;">HACIEN Information Technology Solutions · haciensolutions.com</p>` +
    `<p style="margin:0;font-size:12px;color:#999999;">This is an automated message. Please do not reply.</p>` +
    `</td></tr></table></td></tr></table></body></html>`
  );
}
