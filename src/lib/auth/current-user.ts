import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { can, canSeeCosts, ForbiddenError, type Permission } from "../permissions";
import { clientIp } from "./client-ip";
import { getSessionUser } from "./session";

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof getSessionUser>>>;

/** Per-request cached lookup of the signed-in user. */
export const getCurrentUser = cache(getSessionUser);

/** For pages: redirect to /login when signed out. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** For pages: redirect to /no-access when the user lacks the permission. */
export async function requirePagePermission(permission: Permission): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can(user, permission)) redirect("/no-access");
  return user;
}

/** For cost pages (supplier POs, bills, match): the permission plus "Can see costs", else /no-access. */
export async function requireCostPage(permission: Permission = "view"): Promise<CurrentUser> {
  const user = await requirePagePermission(permission);
  if (!canSeeCosts(user)) redirect("/no-access");
  return user;
}

export { ForbiddenError };

/**
 * For server actions: redirect to /login when signed out (F2, finding 1277).
 * A session that ends while a form is open must send the user to sign in,
 * not strand the entry behind an error: the old signed-out throw surfaced
 * as a form message or the generic error page. Permission failures
 * (signed in, not allowed) still throw ForbiddenError, as before.
 */
export async function requireSignedInUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** For server actions: redirects to /login when signed out; throws when lacking the permission. */
export async function requireActionPermission(permission: Permission): Promise<CurrentUser> {
  const user = await requireSignedInUser();
  if (!can(user, permission)) throw new ForbiddenError();
  return user;
}

/** For cost actions: the permission plus "Can see costs". */
export async function requireCostAction(permission: Permission = "edit_data"): Promise<CurrentUser> {
  const user = await requireActionPermission(permission);
  if (!canSeeCosts(user)) throw new ForbiddenError();
  return user;
}

export async function requestMeta(): Promise<{ ip: string; userAgent: string }> {
  const h = await headers();
  return { ip: clientIp(h), userAgent: (h.get("user-agent") ?? "").slice(0, 255) };
}
