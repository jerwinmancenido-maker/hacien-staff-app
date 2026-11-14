"use server";

// Phase 4 #10: period close actions for the Books card. Both actions
// re-check the periodCloseEnabled flag AND go through the service,
// which re-checks active-Admin — the page's rendering is never trusted.
// Flag OFF blocks the actions while existing locks still guard (K5).

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/current-user";
import { runAction } from "@/lib/actions";
import { DocRuleError } from "@/lib/documents/common";
import { monthLabel } from "@/lib/period-close-shared";
import { closePeriod, isPeriodCloseEnabled, reopenPeriod } from "@/lib/services/period-close";
import { formValues, str, type FormState } from "@/lib/validation/forms";

async function assertFeatureOn() {
  if (!(await isPeriodCloseEnabled())) {
    throw new DocRuleError("Period close is not turned on. An admin can enable it in Settings → Features.");
  }
}

export async function closePeriodAction(_prev: FormState, form: FormData): Promise<FormState> {
  const values = formValues(form);
  return runAction(async () => {
    const user = await requireUser();
    await assertFeatureOn();
    const yearMonth = str(form, "yearMonth");
    await closePeriod(yearMonth, user);
    revalidatePath("/books");
    return { ok: true, message: `${monthLabel(yearMonth)} is now closed.` };
  }, values);
}

export async function reopenPeriodAction(_prev: FormState, form: FormData): Promise<FormState> {
  const values = formValues(form);
  return runAction(async () => {
    const user = await requireUser();
    await assertFeatureOn();
    const yearMonth = str(form, "yearMonth");
    const reason = str(form, "reason");
    await reopenPeriod(yearMonth, reason, user);
    revalidatePath("/books");
    return { ok: true, message: `${monthLabel(yearMonth)} is open again.` };
  }, values);
}
