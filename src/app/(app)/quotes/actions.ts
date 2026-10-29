"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActionPermission } from "@/lib/auth/current-user";
import { runAction } from "@/lib/actions";
import {
  buildQuoteEmailDraft,
  convertQuoteToSalesOrder,
  createQuote,
  markQuoteLost,
  markQuoteSent,
  updateQuote,
  voidQuote,
  type EmailDraft,
} from "@/lib/services/quotes";
import { convertInputSchema, quoteInputSchema, voidReasonSchema } from "@/lib/validation/quotes";
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
    const parsed = quoteInputSchema.safeParse(readJson(form, "payload"));
    if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error), message: "Fix the fields marked below." };
    const quote = id ? await updateQuote(id, parsed.data, user) : await createQuote(parsed.data, user);
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

export async function markQuoteLostAction(id: string): Promise<FormState> {
  return runAction(async () => {
    const user = await requireActionPermission("edit_data");
    await markQuoteLost(id, user);
    revalidatePath("/quotes");
    revalidatePath(`/quotes/${id}`);
    return { ok: true, message: "Marked as lost." };
  });
}

export async function voidQuoteAction(id: string, reason: string): Promise<FormState> {
  return runAction(async () => {
    const user = await requireActionPermission("edit_data");
    const parsed = voidReasonSchema.safeParse(reason);
    if (!parsed.success) return { fieldErrors: { reason: parsed.error.issues[0]?.message ?? "Give a reason." } };
    await voidQuote(id, parsed.data, user);
    revalidatePath("/quotes");
    revalidatePath(`/quotes/${id}`);
    return { ok: true, message: "Quote voided." };
  });
}

export async function convertQuoteAction(id: string, input: { buyerPoNo: string; buyerPoDate: string; deliveryAddress: string }): Promise<FormState> {
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
