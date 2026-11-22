// Pure helpers for the topbar account menu (unit-tested).

export type AccountMenuNavItem = {
  key: "overview" | "password" | "two-step" | "settings";
  href: "/account" | "/account/password" | "/account/two-step" | "/settings";
  label: string;
};

/** Interactive items in order after the name/role header and before Sign out. */
export function accountMenuNavItems(showSettings: boolean): readonly AccountMenuNavItem[] {
  const items: AccountMenuNavItem[] = [
    { key: "overview", href: "/account", label: "My account" },
    { key: "password", href: "/account/password", label: "Change password" },
    { key: "two-step", href: "/account/two-step", label: "Two-step sign-in" },
  ];
  if (showSettings) items.push({ key: "settings", href: "/settings", label: "Settings" });
  return items;
}

/** Full interactive sequence: My account, Change password, Two-step sign-in, optional Settings, then Sign out. */
export function accountMenuActionKeys(showSettings: boolean): readonly ("overview" | "password" | "two-step" | "settings" | "signout")[] {
  return showSettings ? ["overview", "password", "two-step", "settings", "signout"] : ["overview", "password", "two-step", "signout"];
}
