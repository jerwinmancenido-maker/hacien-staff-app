// HTML emails for the staff app: one shared layout, no images, inline CSS
// only (mail clients strip stylesheets and often block images). Brand is the
// app's own: black/white with one blue accent (BRAND_BLUE). The plain-text version
// is always sent alongside, so the message still reads in clients that block
// HTML. All interpolated values are escaped — names come from the database.

import { DEFAULT_SETTINGS } from "./settings/defaults";
import { formatPeso } from "./format";
import { emailIdentity, type EmailIdentity } from "./settings/identity";

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

// The header wordmark, accent and footer follow the CURRENT company
// profile (Company Profile slice 4, census F10) via EmailIdentity;
// the "STAFF APP" lockup suffix is the product descriptor, constant
// across companies. Senders pass the current snapshot's identity;
// the seed profile is the fallback for previews and tests.
export function accountEmailHtml(e: AccountEmail, identity: EmailIdentity = emailIdentity(DEFAULT_SETTINGS)): string {
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
    `<span style="font-size:20px;font-weight:bold;letter-spacing:2px;color:#ffffff;">${escapeHtml(identity.wordmark)}</span>` +
    `<span style="font-size:12px;letter-spacing:2px;color:#cccccc;"> &nbsp;STAFF APP</span>` +
    `</td></tr>` +
    `<tr><td style="padding:32px;">` +
    `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;">${heading}</h1>` +
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Hi ${name},</p>` +
    `<p style="margin:0 0 28px;font-size:15px;line-height:1.6;">${intro}</p>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 28px;"><tr><td align="center" bgcolor="${identity.accentColor}" style="background:${identity.accentColor};border-radius:6px;"><a href="${url}" style="display:inline-block;padding:14px 32px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;">${buttonLabel}</a></td></tr></table>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f7f7;border-radius:6px;">` +
    `<tr><td style="padding:14px 16px;">` +
    `<p style="margin:0 0 6px;font-size:13px;color:#666666;">Button not working? Copy this link into your browser:</p>` +
    `<p style="margin:0;font-size:13px;word-break:break-all;"><a href="${url}" style="color:${identity.accentColor};">${url}</a></p>` +
    `</td></tr></table>` +
    `<p style="margin:24px 0 8px;font-size:13px;color:#666666;">${expiryLine}</p>` +
    `<p style="margin:0;font-size:13px;color:#666666;">${ignoreNote}</p>` +
    `</td></tr>` +
    `<tr><td style="padding:20px 32px;border-top:1px solid #eeeeee;">` +
    `<p style="margin:0 0 4px;font-size:12px;color:#999999;">${escapeHtml(identity.footerLine)}</p>` +
    `<p style="margin:0;font-size:12px;color:#999999;">This is an automated message. Please do not reply.</p>` +
    `</td></tr></table></td></tr></table></body></html>`
  );
}

export type StoreOrderConfirmation = {
  buyerName: string;
  number: string;
  /** 2-dp decimal strings, as stored. */
  amountPaid: string;
  deliveryFee: string;
  lines: { title: string; qty: string; unit: string; unitPrice: string; lineTotal: string }[];
};

function qtyLabel(qty: string): string {
  const n = Number(qty);
  return Number.isInteger(n) ? String(n) : qty.replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * Buyer-facing order confirmation for a paid web order (store intake
 * Slice 1). Same shell as the account emails — wordmark header, identity
 * footer — minus the STAFF APP lockup: the reader is a customer, not staff.
 * Nothing cost-side is ever included: lines show the prices the buyer paid.
 */
export function storeOrderConfirmationEmail(
  o: StoreOrderConfirmation,
  identity: EmailIdentity = emailIdentity(DEFAULT_SETTINGS),
): { subject: string; text: string; html: string } {
  const subject = `Order ${o.number} confirmed — ${identity.shortName}`;
  const hasDelivery = Number(o.deliveryFee) > 0;

  const textLines = [
    `Good day, ${o.buyerName},`,
    "",
    `Thank you — we have received your payment for order ${o.number}.`,
    "",
    ...o.lines.map((l) => `${qtyLabel(l.qty)} ${l.unit} × ${l.title} — ${formatPeso(l.lineTotal)}`),
  ];
  if (hasDelivery) textLines.push(`Delivery fee — ${formatPeso(o.deliveryFee)}`);
  textLines.push(
    `Total paid: ${formatPeso(o.amountPaid)}`,
    "",
    "We will process your order from here. If anything about the order looks wrong, just reply to this email and we will be glad to help.",
    "",
    identity.shortName,
    identity.footerLine,
  );
  const text = textLines.join("\n");

  const rows = o.lines
    .map(
      (l) =>
        `<tr><td style="padding:8px 0;font-size:14px;line-height:1.5;">${escapeHtml(l.title)}<br><span style="color:#666666;font-size:13px;">${escapeHtml(qtyLabel(l.qty))} ${escapeHtml(l.unit)} × ${escapeHtml(formatPeso(l.unitPrice))}</span></td>` +
        `<td align="right" style="padding:8px 0;font-size:14px;white-space:nowrap;">${escapeHtml(formatPeso(l.lineTotal))}</td></tr>`,
    )
    .join("");
  const deliveryRow = hasDelivery
    ? `<tr><td style="padding:8px 0;font-size:14px;">Delivery fee</td><td align="right" style="padding:8px 0;font-size:14px;white-space:nowrap;">${escapeHtml(formatPeso(o.deliveryFee))}</td></tr>`
    : "";
  const html =
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>` +
    `<body style="margin:0;padding:0;background:#f2f2f2;font-family:Arial,Helvetica,sans-serif;color:#111111;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f2;">` +
    `<tr><td align="center" style="padding:40px 16px;">` +
    `<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:#ffffff;border:1px solid #e5e5e5;border-radius:8px;overflow:hidden;">` +
    `<tr><td style="background:#111111;padding:20px 32px;">` +
    `<span style="font-size:20px;font-weight:bold;letter-spacing:2px;color:#ffffff;">${escapeHtml(identity.wordmark)}</span>` +
    `</td></tr>` +
    `<tr><td style="padding:32px;">` +
    `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;">Order confirmed</h1>` +
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Good day, ${escapeHtml(o.buyerName)},</p>` +
    `<p style="margin:0 0 20px;font-size:15px;line-height:1.6;">Thank you — we have received your payment for order <strong>${escapeHtml(o.number)}</strong>.</p>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}${deliveryRow}` +
    `<tr><td style="padding:12px 0 0;font-size:15px;font-weight:bold;border-top:1px solid #eeeeee;">Total paid</td>` +
    `<td align="right" style="padding:12px 0 0;font-size:15px;font-weight:bold;white-space:nowrap;border-top:1px solid #eeeeee;">${escapeHtml(formatPeso(o.amountPaid))}</td></tr></table>` +
    `<p style="margin:24px 0 0;font-size:14px;line-height:1.6;color:#444444;">We will process your order from here. If anything about the order looks wrong, just reply to this email and we will be glad to help.</p>` +
    `</td></tr>` +
    `<tr><td style="padding:20px 32px;border-top:1px solid #eeeeee;">` +
    `<p style="margin:0 0 4px;font-size:12px;color:#999999;">${escapeHtml(identity.footerLine)}</p>` +
    `<p style="margin:0;font-size:12px;color:#999999;">This is an automated message.</p>` +
    `</td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}

export type ReceivingNotification = {
  poNumber: string;
  rrNumber: string;
  supplierName: string;
  recordedByName: string;
  receivedByName: string;
  receivedDateLabel: string;
  fullyReceived: boolean;
  /** Lines on THIS receiving report: qty now, running total, ordered qty. */
  lines: { title: string; unit: string; qtyNow: string; qtyReceivedTotal: string; qtyOrdered: string }[];
  /** Lines still owed after this report (empty when fully received). */
  outstanding: { title: string; unit: string; qtyRemaining: string }[];
  poUrl: string;
};

/**
 * Staff-facing goods-received note (ERP adoption item 5). Quantities only —
 * receiving carries no prices, and this email never shows costs. Same shell
 * as the other staff emails, STAFF APP lockup included: the readers are the
 * team, not a customer.
 */
export function receivingNotificationEmail(
  o: ReceivingNotification,
  identity: EmailIdentity = emailIdentity(DEFAULT_SETTINGS),
): { subject: string; text: string; html: string } {
  const subject = o.fullyReceived
    ? `Goods received — ${o.poNumber} fully received`
    : `Goods received — ${o.poNumber} (partial)`;

  const receivedText = o.lines.map(
    (l) => `- ${l.title} — ${qtyLabel(l.qtyNow)} ${l.unit} received (${qtyLabel(l.qtyReceivedTotal)} of ${qtyLabel(l.qtyOrdered)} ${l.unit} in total)`,
  );
  const outstandingText = o.outstanding.map((l) => `- ${l.title} — ${qtyLabel(l.qtyRemaining)} ${l.unit} still to come`);
  const textLines = [
    `Goods were received for purchase order ${o.poNumber} — receiving report ${o.rrNumber}.`,
    "",
    `Supplier: ${o.supplierName}`,
    `Recorded by: ${o.recordedByName} · Received by: ${o.receivedByName} · Date: ${o.receivedDateLabel}`,
    "",
    "Received this time:",
    ...receivedText,
    "",
    ...(o.fullyReceived
      ? [`This completes the order — everything on ${o.poNumber} has now been received.`, ""]
      : ["Still outstanding:", ...outstandingText, ""]),
    `View the purchase order: ${o.poUrl}`,
    "",
    identity.shortName,
    identity.footerLine,
  ];
  const text = textLines.join("\n");

  const receivedRows = o.lines
    .map(
      (l) =>
        `<tr><td style="padding:8px 0;font-size:14px;line-height:1.5;">${escapeHtml(l.title)}<br><span style="color:#666666;font-size:13px;">${escapeHtml(qtyLabel(l.qtyReceivedTotal))} of ${escapeHtml(qtyLabel(l.qtyOrdered))} ${escapeHtml(l.unit)} in total</span></td>` +
        `<td align="right" style="padding:8px 0;font-size:14px;white-space:nowrap;">${escapeHtml(qtyLabel(l.qtyNow))} ${escapeHtml(l.unit)}</td></tr>`,
    )
    .join("");
  const outstandingBlock = o.fullyReceived
    ? `<p style="margin:20px 0 0;font-size:14px;line-height:1.6;color:#444444;">This completes the order — everything on ${escapeHtml(o.poNumber)} has now been received.</p>`
    : `<p style="margin:20px 0 8px;font-size:14px;font-weight:bold;">Still outstanding</p>` +
      o.outstanding
        .map(
          (l) =>
            `<p style="margin:0 0 4px;font-size:14px;line-height:1.5;">${escapeHtml(l.title)} — ${escapeHtml(qtyLabel(l.qtyRemaining))} ${escapeHtml(l.unit)} still to come</p>`,
        )
        .join("");
  const html =
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>` +
    `<body style="margin:0;padding:0;background:#f2f2f2;font-family:Arial,Helvetica,sans-serif;color:#111111;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f2;">` +
    `<tr><td align="center" style="padding:40px 16px;">` +
    `<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:#ffffff;border:1px solid #e5e5e5;border-radius:8px;overflow:hidden;">` +
    `<tr><td style="background:#111111;padding:20px 32px;">` +
    `<span style="font-size:20px;font-weight:bold;letter-spacing:2px;color:#ffffff;">${escapeHtml(identity.wordmark)}</span>` +
    `<span style="font-size:12px;letter-spacing:2px;color:#cccccc;"> &nbsp;STAFF APP</span>` +
    `</td></tr>` +
    `<tr><td style="padding:32px;">` +
    `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;">Goods received</h1>` +
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Goods were received for purchase order <strong>${escapeHtml(o.poNumber)}</strong> — receiving report ${escapeHtml(o.rrNumber)}.</p>` +
    `<p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#444444;">Supplier: ${escapeHtml(o.supplierName)}<br>Recorded by: ${escapeHtml(o.recordedByName)} · Received by: ${escapeHtml(o.receivedByName)} · Date: ${escapeHtml(o.receivedDateLabel)}</p>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${receivedRows}</table>` +
    outstandingBlock +
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 0;"><tr><td align="center" bgcolor="${identity.accentColor}" style="background:${identity.accentColor};border-radius:6px;"><a href="${escapeHtml(o.poUrl)}" style="display:inline-block;padding:14px 32px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;">View the purchase order</a></td></tr></table>` +
    `</td></tr>` +
    `<tr><td style="padding:20px 32px;border-top:1px solid #eeeeee;">` +
    `<p style="margin:0 0 4px;font-size:12px;color:#999999;">${escapeHtml(identity.footerLine)}</p>` +
    `<p style="margin:0;font-size:12px;color:#999999;">This is an automated message.</p>` +
    `</td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}

export type StaffAlert = {
  subject: string;
  heading: string;
  intro: string;
  /** Detail lines, e.g. "Supplier: Acme Corp". Plain text; escaped in HTML. */
  lines: string[];
  /** View-only link to the record in the app. Alerts never carry actions. */
  url: string;
  urlLabel: string;
};

/**
 * Generic staff alert (ERP adoption item 8): one shell for every alert
 * event — a heading, a one-line summary, the facts, and a view link.
 * Internal readers only (the team), so the STAFF APP lockup stays.
 * Nothing here approves, pays or changes anything: the link only opens
 * the record, and acting on it still needs a sign-in with permission.
 */
export function staffAlertEmail(
  o: StaffAlert,
  identity: EmailIdentity = emailIdentity(DEFAULT_SETTINGS),
): { subject: string; text: string; html: string } {
  const textLines = [
    o.intro,
    "",
    ...o.lines,
    "",
    `${o.urlLabel}: ${o.url}`,
    "",
    identity.shortName,
    identity.footerLine,
  ];
  const text = textLines.join("\n");

  const lineRows = o.lines
    .map(
      (l) =>
        `<p style="margin:0 0 6px;font-size:14px;line-height:1.6;color:#444444;">${escapeHtml(l)}</p>`,
    )
    .join("");
  const html =
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(o.subject)}</title></head>` +
    `<body style="margin:0;padding:0;background:#f2f2f2;font-family:Arial,Helvetica,sans-serif;color:#111111;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f2;">` +
    `<tr><td align="center" style="padding:40px 16px;">` +
    `<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:#ffffff;border:1px solid #e5e5e5;border-radius:8px;overflow:hidden;">` +
    `<tr><td style="background:#111111;padding:20px 32px;">` +
    `<span style="font-size:20px;font-weight:bold;letter-spacing:2px;color:#ffffff;">${escapeHtml(identity.wordmark)}</span>` +
    `<span style="font-size:12px;letter-spacing:2px;color:#cccccc;"> &nbsp;STAFF APP</span>` +
    `</td></tr>` +
    `<tr><td style="padding:32px;">` +
    `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;">${escapeHtml(o.heading)}</h1>` +
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;">${escapeHtml(o.intro)}</p>` +
    lineRows +
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 0;"><tr><td align="center" bgcolor="${identity.accentColor}" style="background:${identity.accentColor};border-radius:6px;"><a href="${escapeHtml(o.url)}" style="display:inline-block;padding:14px 32px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;">${escapeHtml(o.urlLabel)}</a></td></tr></table>` +
    `</td></tr>` +
    `<tr><td style="padding:20px 32px;border-top:1px solid #eeeeee;">` +
    `<p style="margin:0 0 4px;font-size:12px;color:#999999;">${escapeHtml(identity.footerLine)}</p>` +
    `<p style="margin:0;font-size:12px;color:#999999;">This is an automated message.</p>` +
    `</td></tr></table></td></tr></table></body></html>`;
  return { subject: o.subject, text, html };
}

export type CustomerPaymentReceived = {
  customerName: string;
  billingNumber: string;
  salesOrderNumber: string;
  collectionNumber: string;
  collectionDateLabel: string;
  /** 2-dp decimal strings, as stored. */
  cashApplied: string;
  withholdingApplied: string;
  appliedTotal: string;
  /** Balance left on the billing AFTER this payment (canonical billing math). */
  balance: string;
  paidInFull: boolean;
};

/**
 * Buyer-facing payment receipt (ERP adoption item 16): one email per
 * billing a collection settles, in whole or in part. Same customer shell
 * as the store order confirmation — wordmark header, identity footer, no
 * STAFF APP lockup, and NO app link: the reader is a customer with no
 * staff login, so the closing is "just reply to this email", like the
 * statement reminder. Facts only: the amount applied to THIS billing,
 * how it was applied (cash, plus withholding tax where the customer
 * withheld), and the billing's remaining balance or paid-in-full.
 * Collection-level channel fees are the company's own expensed costs —
 * they never reduce what settled the billing, so they are not shown.
 */
export function customerPaymentReceivedEmail(
  o: CustomerPaymentReceived,
  identity: EmailIdentity = emailIdentity(DEFAULT_SETTINGS),
): { subject: string; text: string; html: string } {
  const subject = `Payment received — ${o.billingNumber}`;
  const hasWithholding = Number(o.withholdingApplied) > 0;

  const textLines = [
    `Good day, ${o.customerName},`,
    "",
    `Thank you — we have received your payment and applied it to billing ${o.billingNumber} (sales order ${o.salesOrderNumber}).`,
    "",
    `Collection: ${o.collectionNumber} · Date: ${o.collectionDateLabel}`,
    `Amount applied to this billing: ${formatPeso(o.appliedTotal)}`,
  ];
  if (hasWithholding) {
    textLines.push(
      `Received in cash: ${formatPeso(o.cashApplied)}`,
      `Covered by withholding tax (Form 2307): ${formatPeso(o.withholdingApplied)}`,
    );
  }
  textLines.push("");
  if (o.paidInFull) {
    textLines.push("This billing is now paid in full. Thank you.");
  } else {
    textLines.push(`Remaining balance on this billing: ${formatPeso(o.balance)}`);
  }
  textLines.push(
    "",
    "If anything about this payment looks wrong, just reply to this email and we will be glad to help.",
    "",
    identity.shortName,
    identity.footerLine,
  );
  const text = textLines.join("\n");

  const breakdownRows = hasWithholding
    ? `<tr><td style="padding:8px 0;font-size:14px;">Received in cash</td><td align="right" style="padding:8px 0;font-size:14px;white-space:nowrap;">${escapeHtml(formatPeso(o.cashApplied))}</td></tr>` +
      `<tr><td style="padding:8px 0;font-size:14px;">Covered by withholding tax (Form 2307)</td><td align="right" style="padding:8px 0;font-size:14px;white-space:nowrap;">${escapeHtml(formatPeso(o.withholdingApplied))}</td></tr>`
    : "";
  const balanceBlock = o.paidInFull
    ? `<p style="margin:20px 0 0;font-size:14px;line-height:1.6;color:#444444;">This billing is now <strong>paid in full</strong>. Thank you.</p>`
    : `<p style="margin:20px 0 0;font-size:14px;line-height:1.6;color:#444444;">Remaining balance on this billing: <strong>${escapeHtml(formatPeso(o.balance))}</strong></p>`;
  const html =
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>` +
    `<body style="margin:0;padding:0;background:#f2f2f2;font-family:Arial,Helvetica,sans-serif;color:#111111;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f2;">` +
    `<tr><td align="center" style="padding:40px 16px;">` +
    `<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:#ffffff;border:1px solid #e5e5e5;border-radius:8px;overflow:hidden;">` +
    `<tr><td style="background:#111111;padding:20px 32px;">` +
    `<span style="font-size:20px;font-weight:bold;letter-spacing:2px;color:#ffffff;">${escapeHtml(identity.wordmark)}</span>` +
    `</td></tr>` +
    `<tr><td style="padding:32px;">` +
    `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;">Payment received</h1>` +
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Good day, ${escapeHtml(o.customerName)},</p>` +
    `<p style="margin:0 0 20px;font-size:15px;line-height:1.6;">Thank you — we have received your payment and applied it to billing <strong>${escapeHtml(o.billingNumber)}</strong> (sales order ${escapeHtml(o.salesOrderNumber)}).</p>` +
    `<p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#444444;">Collection: ${escapeHtml(o.collectionNumber)} · Date: ${escapeHtml(o.collectionDateLabel)}</p>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${breakdownRows}` +
    `<tr><td style="padding:12px 0 0;font-size:15px;font-weight:bold;border-top:1px solid #eeeeee;">Amount applied to this billing</td>` +
    `<td align="right" style="padding:12px 0 0;font-size:15px;font-weight:bold;white-space:nowrap;border-top:1px solid #eeeeee;">${escapeHtml(formatPeso(o.appliedTotal))}</td></tr></table>` +
    balanceBlock +
    `<p style="margin:24px 0 0;font-size:14px;line-height:1.6;color:#444444;">If anything about this payment looks wrong, just reply to this email and we will be glad to help.</p>` +
    `</td></tr>` +
    `<tr><td style="padding:20px 32px;border-top:1px solid #eeeeee;">` +
    `<p style="margin:0 0 4px;font-size:12px;color:#999999;">${escapeHtml(identity.footerLine)}</p>` +
    `<p style="margin:0;font-size:12px;color:#999999;">This is an automated message.</p>` +
    `</td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}

export type CustomerDeliveryRecorded = {
  customerName: string;
  salesOrderNumber: string;
  drNumber: string;
  deliveryDateLabel: string;
  receivedByName: string | null;
  /** Lines on THIS delivery: what was handed over this time. */
  lines: { title: string; unit: string; qty: string }[];
  /** Lines still owed after this delivery (empty when fully delivered). */
  remaining: { title: string; unit: string; qtyRemaining: string }[];
  fullyDelivered: boolean;
};

/**
 * Buyer-facing delivery note (ERP adoption item 16): one email per
 * delivery recorded on a sales order. Same customer shell as the store
 * order confirmation — no STAFF APP lockup, no app link, "just reply"
 * closing. Quantities only, exactly as recorded: the DR number, the
 * lines delivered this time, and what remains to deliver (or that the
 * order is complete).
 */
export function customerDeliveryRecordedEmail(
  o: CustomerDeliveryRecorded,
  identity: EmailIdentity = emailIdentity(DEFAULT_SETTINGS),
): { subject: string; text: string; html: string } {
  const subject = `Delivery recorded — ${o.salesOrderNumber}`;

  const deliveredText = o.lines.map((l) => `- ${l.title} — ${qtyLabel(l.qty)} ${l.unit}`);
  const remainingText = o.remaining.map((l) => `- ${l.title} — ${qtyLabel(l.qtyRemaining)} ${l.unit} still to deliver`);
  const textLines = [
    `Good day, ${o.customerName},`,
    "",
    `We have recorded a delivery for your sales order ${o.salesOrderNumber}.`,
    "",
    `Delivery receipt: ${o.drNumber} · Date: ${o.deliveryDateLabel}`,
    ...(o.receivedByName ? [`Received by: ${o.receivedByName}`] : []),
    "",
    "Delivered this time:",
    ...deliveredText,
    "",
    ...(o.fullyDelivered
      ? [`This completes your order — everything on ${o.salesOrderNumber} has now been delivered.`, ""]
      : ["Still to deliver:", ...remainingText, ""]),
    "If anything about this delivery looks wrong, just reply to this email and we will be glad to help.",
    "",
    identity.shortName,
    identity.footerLine,
  ];
  const text = textLines.join("\n");

  const deliveredRows = o.lines
    .map(
      (l) =>
        `<tr><td style="padding:8px 0;font-size:14px;line-height:1.5;">${escapeHtml(l.title)}</td>` +
        `<td align="right" style="padding:8px 0;font-size:14px;white-space:nowrap;">${escapeHtml(qtyLabel(l.qty))} ${escapeHtml(l.unit)}</td></tr>`,
    )
    .join("");
  const remainingBlock = o.fullyDelivered
    ? `<p style="margin:20px 0 0;font-size:14px;line-height:1.6;color:#444444;">This completes your order — everything on ${escapeHtml(o.salesOrderNumber)} has now been delivered.</p>`
    : `<p style="margin:20px 0 8px;font-size:14px;font-weight:bold;">Still to deliver</p>` +
      o.remaining
        .map(
          (l) =>
            `<p style="margin:0 0 4px;font-size:14px;line-height:1.5;">${escapeHtml(l.title)} — ${escapeHtml(qtyLabel(l.qtyRemaining))} ${escapeHtml(l.unit)} still to deliver</p>`,
        )
        .join("");
  const html =
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>` +
    `<body style="margin:0;padding:0;background:#f2f2f2;font-family:Arial,Helvetica,sans-serif;color:#111111;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f2;">` +
    `<tr><td align="center" style="padding:40px 16px;">` +
    `<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:#ffffff;border:1px solid #e5e5e5;border-radius:8px;overflow:hidden;">` +
    `<tr><td style="background:#111111;padding:20px 32px;">` +
    `<span style="font-size:20px;font-weight:bold;letter-spacing:2px;color:#ffffff;">${escapeHtml(identity.wordmark)}</span>` +
    `</td></tr>` +
    `<tr><td style="padding:32px;">` +
    `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;">Delivery recorded</h1>` +
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Good day, ${escapeHtml(o.customerName)},</p>` +
    `<p style="margin:0 0 20px;font-size:15px;line-height:1.6;">We have recorded a delivery for your sales order <strong>${escapeHtml(o.salesOrderNumber)}</strong>.</p>` +
    `<p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#444444;">Delivery receipt: ${escapeHtml(o.drNumber)} · Date: ${escapeHtml(o.deliveryDateLabel)}${o.receivedByName ? `<br>Received by: ${escapeHtml(o.receivedByName)}` : ""}</p>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${deliveredRows}</table>` +
    remainingBlock +
    `<p style="margin:24px 0 0;font-size:14px;line-height:1.6;color:#444444;">If anything about this delivery looks wrong, just reply to this email and we will be glad to help.</p>` +
    `</td></tr>` +
    `<tr><td style="padding:20px 32px;border-top:1px solid #eeeeee;">` +
    `<p style="margin:0 0 4px;font-size:12px;color:#999999;">${escapeHtml(identity.footerLine)}</p>` +
    `<p style="margin:0;font-size:12px;color:#999999;">This is an automated message.</p>` +
    `</td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}
