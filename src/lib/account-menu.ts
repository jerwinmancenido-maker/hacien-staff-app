// Pure helpers for the topbar account menu (unit-tested).

/** Interactive items in order after the name/role header and before Sign out. */
export function accountMenuNavItems(showSettings: boolean): readonly { key: "settings"; href: "/settings"; label: "Settings" }[] {
  return showSettings ? [{ key: "settings", href: "/settings", label: "Settings" }] : [];
}

/** Full interactive sequence: optional Settings, then Sign out (always). */
export function accountMenuActionKeys(showSettings: boolean): readonly ("settings" | "signout")[] {
  return showSettings ? ["settings", "signout"] : ["signout"];
}
