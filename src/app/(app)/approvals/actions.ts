"use server";

import { revalidatePath } from "next/cache";
import { requireActionPermission, requireCostAction } from "@/lib/auth/current-user";
import { runAction } from "@/lib/actions";
import { approveQuote, rejectQuote } from "@/lib/services/quotes";
import { approvePurchaseOrder } from "@/lib/services/purchase-orders";
import type { FormState } from "@/lib/validation/forms";

// Approval inbox actions. Thin wrappers over the SAME services and
// permission gates as the document pages (quotes/actions.ts uses
// requireActionPermission("approve"); purchase-orders/actions.ts uses
// requireCostAction("approve")) — the inbox adds no new permission path
// and no second approval engine; it only revalidates the inbox as well.

export async function approveQuoteFromInboxAction(id: string): Promise<FormState> {
  return runAction(async () => {
    const user = await requireActionPermission("approve");
    await approveQuote(id, user);
    revalidatePath("/approvals");
    revalidatePath("/quotes");
    revalidatePath(`/quotes/${id}`);
    revalidatePath("/");
    return { ok: true, message: "Quote approved." };
  });
}

export async function rejectQuoteFromInboxAction(id: string, reason: string): Promise<FormState> {
  return runAction(async () => {
    const user = await requireActionPermission("approve");
    const why = reason.trim();
    if (!why) return { fieldErrors: { reason: "Give a reason." }, message: "Give a reason for rejecting this quote." };
    await rejectQuote(id, why, user);
    revalidatePath("/approvals");
    revalidatePath("/quotes");
    revalidatePath(`/quotes/${id}`);
    revalidatePath("/");
    return { ok: true, message: "Quote rejected." };
  });
}

export async function approvePoFromInboxAction(id: string): Promise<FormState> {
  return runAction(async () => {
    const user = await requireCostAction("approve");
    await approvePurchaseOrder(id, user);
    revalidatePath("/approvals");
    revalidatePath("/purchase-orders");
    revalidatePath(`/purchase-orders/${id}`);
    revalidatePath("/");
    return { ok: true, message: "PO approved." };
  });
}
