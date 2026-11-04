"use server";

import { revalidatePath } from "next/cache";
import { requireActionPermission } from "@/lib/auth/current-user";
import { runAction } from "@/lib/actions";
import { str, type FormState } from "@/lib/validation/forms";
import { createReminder, setReminderDone } from "@/lib/services/reminders";

/** S-56: Remind-me form on quote / SO / PO pages, and the Reminders page. */
export async function createReminderAction(_prev: FormState, form: FormData): Promise<FormState> {
  return runAction(async () => {
    const user = await requireActionPermission("edit_data");
    await createReminder(user.id, {
      entityType: str(form, "entityType"),
      entityId: str(form, "entityId"),
      remindAt: str(form, "remindAt"),
      note: str(form, "note"),
    });
    revalidatePath("/reminders");
    return { ok: true, message: "Reminder set." };
  });
}

export async function setReminderDoneAction(id: string, done: boolean): Promise<void> {
  const user = await requireActionPermission("edit_data");
  await setReminderDone(id, user.id, done);
  revalidatePath("/reminders");
}
