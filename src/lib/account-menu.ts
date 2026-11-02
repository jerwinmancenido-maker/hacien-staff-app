// Pure helpers for the topbar account menu (unit-tested).

export type AccountMenuNavItem = {
  key: "password" | "settings";
  href: "/account/password" | "/settings";
  label: string;
};

/** Interactive items in order after the name/role header and before Sign out. */
export function accountMenuNavItems(showSettings: boolean): readonly AccountMenuNavItem[] {
  const items: AccountMenuNavItem[] = [{ key: "password", href: "/account/password", label: "Change password" }];
  if (showSettings) items.push({ key: "settings", href: "/settings", label: "Settings" });
  return items;
}

/** Full interactive sequence: Change password, optional Settings, then Sign out. */
export function accountMenuActionKeys(showSettings: boolean): readonly ("password" | "settings" | "signout")[] {
  return showSettings ? ["password", "settings", "signout"] : ["password", "signout"];
}
