// Role and permission rules. Pure functions (no DB) so they are easy to test.
// Every server page and action must call these; hiding buttons is not enough.

export type Role = "ADMIN" | "APPROVER" | "STAFF" | "VIEWER";

export const ROLES: readonly Role[] = ["ADMIN", "APPROVER", "STAFF", "VIEWER"];

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Admin",
  APPROVER: "Approver",
  STAFF: "Staff",
  VIEWER: "Viewer",
};

export type Permission =
  | "view" // read master data
  | "edit_data" // create/update customers, suppliers, contacts
  | "approve" // approve supplier POs (quotes later)
  | "manage_billing" // record/void billings & collections, mark 2307 received
  | "manage_settings"
  | "manage_users"
  | "view_audit";

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  // Admins can approve POs too, so a small team isn't blocked when the only
  // approver is away. The last-approver guard still keeps one Approver role.
  // Admin + Approver may manage billing (Jerwin Oct 30, 2026).
  ADMIN: ["view", "edit_data", "approve", "manage_billing", "manage_settings", "manage_users", "view_audit"],
  APPROVER: ["view", "edit_data", "approve", "manage_billing"],
  STAFF: ["view", "edit_data"],
  VIEWER: ["view"],
};

/** The subset of a user record that permission checks need. */
export type RoleFlags = {
  isAdmin: boolean;
  isApprover: boolean;
  isStaff: boolean;
  isViewer: boolean;
};

export type PermissionUser = RoleFlags & {
  active: boolean;
  canSeeCosts: boolean;
};

export function rolesOf(user: RoleFlags): Role[] {
  const roles: Role[] = [];
  if (user.isAdmin) roles.push("ADMIN");
  if (user.isApprover) roles.push("APPROVER");
  if (user.isStaff) roles.push("STAFF");
  if (user.isViewer) roles.push("VIEWER");
  return roles;
}

export function roleFlags(roles: readonly Role[]): RoleFlags {
  return {
    isAdmin: roles.includes("ADMIN"),
    isApprover: roles.includes("APPROVER"),
    isStaff: roles.includes("STAFF"),
    isViewer: roles.includes("VIEWER"),
  };
}

export function roleLabel(user: RoleFlags): string {
  return rolesOf(user)
    .map((r) => ROLE_LABELS[r])
    .join(" · ");
}

/** Inactive users have no permissions at all. Permissions are the union of the user's roles. */
export function can(user: PermissionUser | null | undefined, permission: Permission): boolean {
  if (!user || !user.active) return false;
  return rolesOf(user).some((role) => ROLE_PERMISSIONS[role].includes(permission));
}

/**
 * Costs (supplier costs, margins) are only sent by the server to users with the
 * "Can see costs" flag. Independent of role: even an Admin needs the flag.
 */
export function canSeeCosts(user: PermissionUser | null | undefined): boolean {
  return !!user && user.active && user.canSeeCosts === true;
}

/**
 * Field names that count as cost data. Quote/SO views are built without these
 * for non-cost users (src/lib/quotes/views.ts); stripCosts() is the backstop
 * for anything else that may hold them (e.g. audit diffs).
 */
export const COST_FIELDS = [
  "cost",
  "unitCost",
  "supplierCost",
  "totalCost",
  "margin",
  "marginPct",
  "supplierId",
  "supplierName",
  "supplierUnitCost",
  "supplierTotal",
  "netMargin",
  "netMarginPct",
] as const;

/**
 * Remove cost fields (recursively) from data before it leaves the server, unless
 * the user may see costs. Use on every payload that can contain costs.
 */
export function stripCosts<T>(data: T, user: PermissionUser | null | undefined): T {
  if (canSeeCosts(user)) return data;
  return strip(data) as T;
}

function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strip);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if ((COST_FIELDS as readonly string[]).includes(k)) continue;
      out[k] = strip(v);
    }
    return out;
  }
  return value;
}

export class ForbiddenError extends Error {
  constructor() {
    super("You don't have permission to do that.");
    this.name = "ForbiddenError";
  }
}

/** Server-side check for services: throws ForbiddenError unless the user has the permission. */
export function assertCan(user: PermissionUser | null | undefined, permission: Permission): void {
  if (!can(user, permission)) throw new ForbiddenError();
}

// ---------------------------------------------------------------------------
// Last Admin / last Approver guard
// ---------------------------------------------------------------------------

export type GuardUser = RoleFlags & { id: string; active: boolean };

/**
 * Check a change to one user (turn off or role change) against all users.
 * Returns an error message if the change would leave no active Admin or no
 * active Approver, otherwise null.
 */
export function lastRoleGuard(
  allUsers: readonly GuardUser[],
  targetId: string,
  next: { active: boolean } & RoleFlags,
): string | null {
  const after = allUsers.map((u) => (u.id === targetId ? { ...u, ...next } : u));
  const target = allUsers.find((u) => u.id === targetId);
  const turningOff = !!target && target.active && !next.active;

  const activeAdmins = after.filter((u) => u.active && u.isAdmin).length;
  const activeApprovers = after.filter((u) => u.active && u.isApprover).length;
  const hadAdmins = allUsers.some((u) => u.active && u.isAdmin);
  const hadApprovers = allUsers.some((u) => u.active && u.isApprover);

  if (hadApprovers && activeApprovers === 0) {
    return turningOff ? "Can't turn off the last approver." : "Can't remove the Approver role from the last approver.";
  }
  if (hadAdmins && activeAdmins === 0) {
    return turningOff ? "Can't turn off the last admin." : "Can't remove the Admin role from the last admin.";
  }
  return null;
}
