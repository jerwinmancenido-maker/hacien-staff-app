"use server";

import { revalidatePath } from "next/cache";
import { requireActionPermission } from "@/lib/auth/current-user";
import { retryMessage } from "@/lib/messaging/send";

/** Retry a logged message from the Admin send log. */
export async function retryMessageFormAction(logId: string): Promise<void> {
  await requireActionPermission("manage_settings");
  await retryMessage(logId);
  revalidatePath("/messages");
}
