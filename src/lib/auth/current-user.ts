import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { can, type Permission } from "../permissions";
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

export class ForbiddenError extends Error {
  constructor() {
    super("You don't have permission to do that.");
    this.name = "ForbiddenError";
  }
}

/** For server actions: throws when signed out or lacking the permission. */
export async function requireActionPermission(permission: Permission): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user || !can(user, permission)) throw new ForbiddenError();
  return user;
}

export async function requestMeta(): Promise<{ ip: string; userAgent: string }> {
  const h = await headers();
  const ip = (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim();
  return { ip: ip.slice(0, 64), userAgent: (h.get("user-agent") ?? "").slice(0, 255) };
}
