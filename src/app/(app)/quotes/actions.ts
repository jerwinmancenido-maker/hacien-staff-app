"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser, requireActionPermission } from "@/lib/auth/current-user";
import { assertCanVoid, ForbiddenError } from "@/lib/permissions";
import { runAction } from "@/lib/actions";
import { db } from "@/lib/db";
import { createAttachments, discardUploads, prepareUploads } from "@/lib/services/attachments";
import { isoDate } from "@/lib/format";
import {
  approveQuote,
  buildQuoteEmailDraft,
  convertQuoteToSalesOrder,
  copyQuote,
  createQuote,
  markQuoteLost,
  confirmNoneAndMarkQuoteSent,
  markQuoteSent,
  recordQuoteAcceptance,
  refreshQuoteCompanyDetails,
  rejectQuote,
  updateQuote,
  voidQuote,
  type EmailDraft,
} from "@/lib/services/quotes";
import { acceptanceInputSchema, convertInputSchema, quoteInputSchemaForSave, voidReasonSchema } from "@/lib/validation/quotes";
import { getQuoteView } from "@/lib/quotes/views";
import { str, zodFieldErrors, type FormState } from "@/lib/validation/forms";

function readJson(form: FormData, key: string): unknown {
  try {
    return JSON.parse(str(form, key));
  } catch {
    return null;
  }
}

/** Create (id null) or edit a quote. The editor posts everything as JSON in "payload". */
export async function saveQuoteAction(id: string | null, _prev: FormState, form: FormData): Promise<FormState> {
  let goTo: string | null = null;
  const result = await runAction(async () => {
    const user = await requireActionPermission("edit_data");
    const raw = readJson(form, "payload");
    // Same-day validUntil is rejected for new quotes and for any date change.
    // An existing quote keeps saving when its stored pair is left as-is.
    let stored: { date: string; validUntil: string } | null = null;
    if (id) {
      const existing = await db.quote.findUnique({ where: { id }, select: { date: true, validUntil: true } });
      if (existing) stored = { date: isoDate(existing.date), validUntil: isoDate(existing.validUntil) };
    }
    const parsed = quoteInputSchemaForSave(raw, stored).safeParse(raw);
    if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), message: "Fix the fields marked below." };
    const quote = id ? await updateQuote(id, parsed.data, user) : await createQuote(parsed.data, user);
    // Mark as sent in this same request. A successful save redirects, so the
    // editor never sees ok and cannot call markQuoteSent afterwards.
    if (id && str(form, "alsoMarkSent") === "1") await markQuoteSent(quote.id, user);
    revalidatePath("/quotes");
    revalidatePath(`/quotes/${quote.id}`);
    goTo = `/quotes/${quote.id}`;
    return { ok: true };
  });
  if (goTo) redirect(goTo);
  return result;
}

export async function markQuoteSentAction(id: string): Promise<FormState> {
  return runAction(async () => {
    const user = await requireActionPermission("edit_data");
    await markQuoteSent(id, user);
    revalidatePath("/quotes");
    revalidatePath(`/quotes/${id}`);
    return { ok: true, message: "Marked as sent." };
  });
}

/** "Yes, none" on the submit confirm: store explicit none, then mark as sent. */
export async function confirmNoneAndMarkQuoteSentAction(id: string): Promise<FormState> {
  return runAction(async () => {
    const user = await requireActionPermission("edit_data");
    await confirmNoneAndMarkQuoteSent(id, user);
    revalidatePath("/quotes");
    revalidatePath(`/quotes/${id}`);
    return { ok: true, message: "Marked as sent with no withholding." };
  });
}

export async function markQuoteLostAction(id: string): Promise<FormState> {
  return runAction(async () => {
    const user = await requireActionPermission("edit_data");
    await markQuoteLost(id, user);
    revalidatePath("/quotes");
    revalidatePath(`/quotes/${id}`);
    return { ok: true, message: "Marked as lost." };
  });
}

/** S-55: copy a quote into a fresh draft (Rev 1). */
export async function duplicateQuoteAction(id: string): Promise<FormState & { newQuoteId?: string }> {
  return runAction(async () => {
    const user = await requireActionPermission("edit_data");
    const copy = await copyQuote(id, user, 1);
    revalidatePath("/quotes");
    return { ok: true, message: `Duplicated as ${copy.number}.`, newQuoteId: copy.id };
  });
}

/** S-55: copy a quote into a fresh draft with revision + 1. The original is left untouched. */
export async function newRevisionQuoteAction(id: string): Promise<FormState & { newQuoteId?: string }> {
  return runAction(async () => {
    const user = await requireActionPermission("edit_data");
    const original = await getQuoteView(id, user);
    if (!original) throw new Error("Quote not found.");
    if (original.status !== "SENT" && original.status !== "WON") {
      throw new Error("New revision is for sent or won quotes — a draft is edited in place.");
    }
    const copy = await copyQuote(id, user, original.revision + 1);
    revalidatePath("/quotes");
    return { ok: true, message: `New revision ${copy.number} (Rev ${copy.revision}) created.`, newQuoteId: copy.id };
  });
}

/** Draft quotes only — refresh letterhead from the latest company settings. */
export async function refreshQuoteCompanyDetailsAction(id: string): Promise<FormState> {
  return runAction(async () => {
    const user = await requireActionPermission("edit_data");
    await refreshQuoteCompanyDetails(id, user);
    revalidatePath("/quotes");
    revalidatePath(`/quotes/${id}`);
    revalidatePath(`/print/quotes/${id}`);
    return { ok: true, message: "Company details updated from settings." };
  });
}

export async function voidQuoteAction(id: string, reason: string): Promise<FormState> {
  return runAction(async () => {
    const user = await getCurrentUser();
    if (!user) throw new ForbiddenError();
    assertCanVoid(user);
    const parsed = voidReasonSchema.safeParse(reason);
    if (!parsed.success) return { fieldErrors: { reason: parsed.error.issues[0]?.message ?? "Give a reason." } };
    await voidQuote(id, parsed.data, user);
    revalidatePath("/quotes");
    revalidatePath(`/quotes/${id}`);
    return { ok: true, message: "Quote voided." };
  });
}

export async function convertQuoteAction(id: string, input: { buyerPoNo: string; buyerPoDate: string; deliveryAddressId: string; deliveryAddress?: string }): Promise<FormState> {
  let goTo: string | null = null;
  const result = await runAction(async () => {
    const user = await requireActionPermission("edit_data");
    const parsed = convertInputSchema.safeParse(input);
    if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), message: "Fix the fields marked below." };
    const so = await convertQuoteToSalesOrder(id, parsed.data, user);
    revalidatePath("/quotes");
    revalidatePath(`/quotes/${id}`);
    revalidatePath("/sales-orders");
    goTo = `/sales-orders/${so.id}`;
    return { ok: true };
  });
  if (goTo) redirect(goTo);
  return result;
}

/** Builds the email draft and logs it. Never sends anything. */
export async function emailDraftAction(id: string): Promise<FormState & { draft?: EmailDraft }> {
  let draft: EmailDraft | undefined;
  const result = await runAction(async () => {
    const user = await requireActionPermission("edit_data");
    draft = await buildQuoteEmailDraft(id, user);
    revalidatePath(`/quotes/${id}`);
    return { ok: true };
  });
  return draft ? { ...result, draft } : result;
}

export async function approveQuoteAction(id: string): Promise<FormState> {
  return runAction(async () => {
    const user = await requireActionPermission("approve");
    await approveQuote(id, user);
    revalidatePath("/quotes");
    revalidatePath(`/quotes/${id}`);
    revalidatePath("/");
    return { ok: true, message: "Quote approved." };
  });
}

export async function rejectQuoteAction(id: string, reason: string): Promise<FormState> {
  return runAction(async () => {
    const user = await requireActionPermission("approve");
    const why = reason.trim();
    if (!why) return { fieldErrors: { reason: "Give a reason." }, message: "Give a reason for rejecting this quote." };
    await rejectQuote(id, why, user);
    revalidatePath("/quotes");
    revalidatePath(`/quotes/${id}`);
    revalidatePath("/");
    return { ok: true, message: "Quote rejected." };
  });
}

/** Audit (2026-11-05): record customer acceptance (date, name, how) on a quote. */
export async function recordQuoteAcceptanceAction(id: string, _prev: FormState, form: FormData): Promise<FormState> {
  return runAction(async () => {
    const user = await requireActionPermission("edit_data");
    const parsed = acceptanceInputSchema.safeParse({
      acceptedAt: str(form, "acceptedAt"),
      acceptedBy: str(form, "acceptedBy"),
      acceptedVia: str(form, "acceptedVia"),
    });
    if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), message: "Fix the fields marked below." };
    await recordQuoteAcceptance(id, parsed.data, user);
    revalidatePath(`/quotes/${id}`);
    return { ok: true, message: "Acceptance recorded." };
  });
}

/** S-70: upload a signed conforme scan and save it on the quote. */
export async function uploadQuoteConformeAction(id: string, _prev: FormState, form: FormData): Promise<FormState> {
  return runAction(async () => {
    const user = await requireActionPermission("edit_data");
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return { fieldErrors: { file: "Pick a file to upload." } };
    const uploads = await prepareUploads([{ name: file.name, size: file.size, bytes: new Uint8Array(await file.arrayBuffer()) }]);
    try {
      await db.$transaction(async (tx) => {
        await createAttachments(tx, uploads, { quoteId: id }, user.id);
      });
    } catch (e) {
      await discardUploads(uploads);
      throw e;
    }
    revalidatePath(`/quotes/${id}`);
    return { ok: true, message: "Signed conforme uploaded." };
  });
}
