"use server";

import { revalidatePath } from "next/cache";
import { requireActionPermission } from "@/lib/auth/current-user";
import { runAction } from "@/lib/actions";
import type { FormState } from "@/lib/validation/forms";
import { sendStatementReminder } from "@/lib/services/statement-reminder";

/**
 * Phase 3 #9: email this customer's statement of account (all-time) as a
 * payment reminder. The service enforces the config check, the recipient
 * rule, the nothing-due rule and the duplicate guard; this action only
 * maps its result onto form feedback.
 */
export async function sendStatementReminderAction(
  customerId: string,
  _prev: FormState,
  _form: FormData,
): Promise<FormState> {
  return runAction(async () => {
    const user = await requireActionPermission("edit_data");
    const result = await sendStatementReminder(user.id, customerId, { from: null, to: null });
    if (!result.ok) return { ok: false, message: result.message };
    revalidatePath(`/customers/${customerId}`);
    return { ok: true, message: `Statement sent to ${result.to}.` };
  });
}
