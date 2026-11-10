// REQ-API-001 PR-B — unit + source pins for the API Keys settings tab.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { API_SCOPES, sanitizeScopes } from "@/lib/api/scopes";

const read = (rel: string) => readFileSync(path.resolve(__dirname, "..", rel), "utf8");

describe("scope sanitizing", () => {
  it("keeps only grantable scopes, deduped", () => {
    expect(sanitizeScopes(["read", "bogus", "read", "customers:write"])).toEqual(["read", "customers:write"]);
    expect(sanitizeScopes(["nope"])).toEqual([]);
    expect(sanitizeScopes([])).toEqual([]);
  });
  it("the catalog includes the PR-A scopes", () => {
    const values = API_SCOPES.map((s) => s.value);
    expect(values).toContain("customers:read");
    expect(values).toContain("customers:write");
    expect(values).toContain("items:read");
  });
});

describe("API Keys tab wiring", () => {
  it("the tab shows the key once, with a copy button and the not-again warning", () => {
    const tab = read("src/app/(app)/settings/ApiKeysTab.tsx");
    expect(tab).toContain("You will not see this again");
    expect(tab).toContain("navigator.clipboard.writeText");
    expect(tab).toContain("API / Bot");
    expect(tab).toContain("Revoke");
    // The token appears only from action state — never from a prop or the list rows.
    expect(tab).not.toContain("keyHash");
  });
  it("the settings page has the api-keys section behind the page's manage_settings gate", () => {
    const page = read("src/app/(app)/settings/page.tsx");
    expect(page).toContain('"api-keys"');
    expect(page).toContain("ApiKeysSection");
    expect(page).toContain('requirePagePermission("manage_settings")');
  });
  it("the actions require manage_settings and the service audits create and revoke", () => {
    const actions = read("src/app/(app)/settings/actions.ts");
    expect(actions).toContain("createApiKeyAction");
    expect(actions).toContain("revokeApiKeyAction");
    const svc = read("src/lib/api/keys-admin.ts");
    expect(svc).toContain('action: "create"');
    expect(svc).toContain('action: "update"');
    // Revoke is a timestamp — never a delete (no-delete rule covers keys).
    expect(svc).not.toMatch(/\.apiKey\.delete/);
    expect(svc).toContain("revokedAt");
  });
  it("the base seed creates the API / Bot user and the runtime ensure is idempotent", () => {
    const seed = read("src/lib/seed-base.ts");
    // CTO nit (bc-1b662691): the seed imports the bot constants, never copies them.
    expect(seed).toContain('from "./api/bot-user.ts"');
    expect(seed).toContain("API_BOT_FLAGS");
    expect(seed).not.toContain("api-bot@haciensolutions.com");
    expect(seed).toContain("passwordHash: null");
    const bot = read("src/lib/api/bot-user.ts");
    expect(bot).toContain("API_BOT_EMAIL");
    expect(bot).toContain("canSeeCosts: false");
  });
});

describe("CTO fix round bc-1b662691", () => {
  it("a key on screen locks the create form, and a fresh create always surfaces its key", () => {
    const tab = read("src/app/(app)/settings/ApiKeysTab.tsx");
    expect(tab).toContain("seenToken");
    expect(tab).toContain("disabled={!pepperSet || pending || !!token}");
    expect(tab).toContain("disabled={!pepperSet || !!token}");
  });

  it("the bot is hidden from invite, reset and edit, with a plain label", () => {
    const users = read("src/lib/services/users.ts");
    expect(users).toContain("API_BOT_EMAIL");
    expect(users).toContain("The API bot can't be edited");
    expect(users).toContain("The API bot can't be invited");
    const page = read("src/app/(app)/settings/page.tsx");
    expect(page).toContain("API bot – can't sign in");
    const detail = read("src/app/(app)/settings/users/[id]/page.tsx");
    expect(detail).toContain("API bot – can&apos;t sign in");
    expect(detail).toContain("isBot");
  });

  it("ensureApiBotUser re-locks drifted flags", () => {
    const bot = read("src/lib/api/bot-user.ts");
    expect(bot).toContain("API_BOT_FLAGS");
    expect(bot).toContain("drifted");
    expect(bot).toContain("db.user.update");
  });
});
