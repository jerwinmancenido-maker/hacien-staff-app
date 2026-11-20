// Duplicate-name soft warning lookup (final-check finding F4):
// findCustomerWithName matches an exact customer name case-insensitively and
// nothing else. Runs on MySQL 8 (TEST_DATABASE_URL); skipped locally.

import { afterAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

import { db } from "@/lib/db";
import { findCustomerWithName } from "@/lib/services/companies";
import { tag } from "./fixtures";

describe.skipIf(!env.hasDb)("customer duplicate-name lookup (MySQL)", () => {
  afterAll(async () => {
    await db.$disconnect();
  });

  it("finds the exact name in any case, and misses partial or unknown names", async () => {
    const t = tag();
    const name = `Duplicate Name Corp ${t}`;
    const created = await db.customer.create({ data: { name, withholdingType: "NONE" } });

    const found = await findCustomerWithName(name.toLowerCase());
    expect(found?.id).toBe(created.id);
    expect(found?.name).toBe(name);

    expect(await findCustomerWithName(`Duplicate Name Corp`)).toBeNull();
    expect(await findCustomerWithName(`No Such Customer ${t}`)).toBeNull();
  });
});
