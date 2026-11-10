import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Prisma } from "@prisma/client";
import { DEFAULT_SETTINGS } from "./settings/defaults.ts";
import { WITHHOLDING_DEFAULT_ROWS } from "./quotes/withholding-defaults.ts";

/** Models touched by the base seed. Must contain ONLY system/configuration models. */
export const BASE_SEED_MODELS = ["settingsVersion", "user", "withholdingRate"] as const;

/** Business models that must NEVER be written by the base seed. */
export const BUSINESS_MODELS = [
  "customer",
  "supplier",
  "quote",
  "salesOrder",
  "billing",
  "collection",
  "payment",
  "expense",
  "purchaseOrder",
] as const;

export type SeedUser = {
  email: string;
  name: string;
  isAdmin?: boolean;
  isApprover?: boolean;
  isStaff?: boolean;
  isViewer?: boolean;
  canSeeCosts: boolean;
};

/** Pass 3 Settings → Withholding catalog (labels + ATCs Confirmed; rates Unverified). */
export const WITHHOLDING_RATES = Object.values(WITHHOLDING_DEFAULT_ROWS).map((r) => ({
  code: r.code,
  label: r.label,
  lineKind: r.lineKind,
  rate: r.rate,
  atcCode: r.atcCode,
  active: r.active,
  sortOrder: r.sortOrder,
}));

export type BaseSeedDb = {
  settingsVersion: {
    count: (args?: Prisma.SettingsVersionCountArgs) => Promise<number>;
    create: (args: Prisma.SettingsVersionCreateArgs) => Promise<unknown>;
  };
  user: {
    findUnique: (args: Prisma.UserFindUniqueArgs) => Promise<{ id: string; email: string } | null>;
    create: (args: Prisma.UserCreateArgs) => Promise<unknown>;
  };
  withholdingRate: {
    findUnique: (args: Prisma.WithholdingRateFindUniqueArgs) => Promise<unknown | null>;
    create: (args: Prisma.WithholdingRateCreateArgs) => Promise<unknown>;
    update: (args: Prisma.WithholdingRateUpdateArgs) => Promise<unknown>;
    updateMany: (args: Prisma.WithholdingRateUpdateManyArgs) => Promise<unknown>;
  };
};

/**
 * Runs the BASE seed: Settings defaults, withholding catalog, and the first Admin.
 * NO customers, suppliers, quotes, SOs, billings, payments, or any other business/sales records.
 */
export async function seedBase(db: BaseSeedDb): Promise<{ createdUsers: string[] }> {
  // 1. Settings: version 1 from defaults, only if there is none yet.
  if ((await db.settingsVersion.count()) === 0) {
    await db.settingsVersion.create({ data: { version: 1, data: DEFAULT_SETTINGS } });
    console.log("Settings: created version 1 from defaults.");
  }

  // 2. First Admin from existing env vars (or jerwin@example.com default)
  const created: string[] = [];
  const adminEmail = process.env.ADMIN_EMAIL || "jerwin@example.com";
  const adminName = process.env.ADMIN_NAME || "Jerwin";

  const existingAdmin = await db.user.findUnique({ where: { email: adminEmail } });
  if (!existingAdmin) {
    const password = process.env.SEED_PASSWORD || randomBytes(24).toString("base64url");
    await db.user.create({
      data: {
        email: adminEmail,
        name: adminName,
        isAdmin: true,
        isApprover: true,
        isStaff: false,
        isViewer: false,
        canSeeCosts: true,
        passwordHash: await bcrypt.hash(password, 12),
      },
    });
    created.push(adminEmail);
  }

  // 2b. The dedicated "API / Bot" acting user for /api/v1 (REQ-API-001
  // PR-B). Create-if-missing only — an existing row is never modified, so
  // admin flag changes on staging/live are not overwritten by a re-seed.
  // It can never sign in: passwordHash stays null and no invite is sent.
  const API_BOT_EMAIL = "api-bot@haciensolutions.com";
  const existingBot = await db.user.findUnique({ where: { email: API_BOT_EMAIL } });
  if (!existingBot) {
    await db.user.create({
      data: {
        email: API_BOT_EMAIL,
        name: "API / Bot",
        passwordHash: null,
        isAdmin: false,
        isApprover: false,
        isStaff: true,
        isViewer: false,
        canSeeCosts: false,
        active: true,
      },
    });
    created.push(API_BOT_EMAIL);
    console.log("API / Bot user created (acts for /api/v1 keys; cannot sign in).");
  }

  // 3. Withholding rates: upsert Pass 3 catalog and deactivate deprecated rows.
  for (const r of WITHHOLDING_RATES) {
    const existing = await db.withholdingRate.findUnique({ where: { code: r.code } });
    if (existing) {
      await db.withholdingRate.update({
        where: { code: r.code },
        data: {
          label: r.label,
          lineKind: r.lineKind,
          atcCode: r.atcCode,
          rate: r.rate,
          active: r.active,
          sortOrder: r.sortOrder,
          note: "verify with BIR",
        },
      });
      continue;
    }
    await db.withholdingRate.create({
      data: {
        code: r.code,
        label: r.label,
        lineKind: r.lineKind,
        atcCode: r.atcCode,
        rate: r.rate,
        active: r.active,
        note: "verify with BIR",
        sortOrder: r.sortOrder,
      },
    });
  }
  await db.withholdingRate.updateMany({
    where: { OR: [{ code: { startsWith: "LINE_" } }, { label: "Goods 4%" }] },
    data: { active: false },
  });

  if (created.length) {
    const how = process.env.SEED_PASSWORD ? "the password in SEED_PASSWORD" : 'a random password (use "Forgot password" to set one)';
    console.log(`Admin user (${created.join(", ")}) was created with ${how}.`);
  }

  return { createdUsers: created };
}
