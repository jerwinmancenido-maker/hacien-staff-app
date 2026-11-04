"use server";

import { redirect } from "next/navigation";
import { requestMeta } from "@/lib/auth/current-user";
import { unsubscribeViaLink, verifyUnsubscribeToken } from "@/lib/marketing-consent";

/** One-click unsubscribe: the token is verified before any state change. */
export async function unsubscribeAction(token: string): Promise<void> {
  if (!verifyUnsubscribeToken(token)) redirect("/unsubscribe?error=invalid");
  const meta = await requestMeta().catch(() => ({ ip: null, userAgent: null }));
  const result = await unsubscribeViaLink(token, meta);
  if (!result.ok) redirect("/unsubscribe?error=invalid");
  redirect("/unsubscribe?done=1");
}
