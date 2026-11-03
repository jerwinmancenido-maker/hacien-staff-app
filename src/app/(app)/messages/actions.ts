"use server";

import { revalidatePath } from "next/cache";
import { requireActionPermission } from "@/lib/auth/current-user";
import { getSettingsSnapshot, saveSettings } from "@/lib/settings";
import { retryMessage } from "@/lib/messaging/send";

/**
 * Save the Admin order-text toggles (Q16, S-95). Checkbox absent = off.
 * A template on alone never sends while orderTextsEnabled is off, and
 * nothing is sent at all until the provider keys are set (Q15 base).
 */
export async function saveOrderTextTogglesFormAction(form: FormData): Promise<void> {
  const user = await requireActionPermission("manage_settings");
  const { settings, versionId } = await getSettingsSnapshot();
  const next = {
    orderTextsEnabled: form.get("orderTextsEnabled") === "on",
    orderConfirmed: form.get("orderConfirmed") === "on",
    orderDelivered: form.get("orderDelivered") === "on",
    orderPayment: form.get("orderPayment") === "on",
  };
  // Keep the existing snapshot's other messaging fields (none today) by
  // saving the full messaging object, not a partial one.
  const result = await saveSettings({
    key: "messaging",
    value: { ...settings.messaging, ...next },
    userId: user.id,
    baseVersionId: versionId,
  });
  if (!result.ok) throw new Error("Could not save order text toggles. Reload and try again.");
  revalidatePath("/messages");
}

/** Retry a logged message from the Admin send log. */
export async function retryMessageFormAction(logId: string): Promise<void> {
  await requireActionPermission("manage_settings");
  await retryMessage(logId);
  revalidatePath("/messages");
}
