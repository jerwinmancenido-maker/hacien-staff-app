import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { assertNotDelete, HardDeleteError, noDeleteExtension } from "@/lib/no-delete";

describe("no hard deletes", () => {
  it("assertNotDelete throws for delete and deleteMany only", () => {
    expect(() => assertNotDelete("Customer", "delete")).toThrow(HardDeleteError);
    expect(() => assertNotDelete("Contact", "deleteMany")).toThrow(HardDeleteError);
    expect(() => assertNotDelete("Customer", "update")).not.toThrow();
    expect(() => assertNotDelete("Customer", "create")).not.toThrow();
  });

  it("the extended Prisma client throws on delete/deleteMany before touching the database", async () => {
    // Unreachable database: if the guard didn't run first we'd get a connection error instead.
    const client = new PrismaClient({ datasourceUrl: "mysql://nobody:nothing@127.0.0.1:1/none" }).$extends(noDeleteExtension);
    await expect(client.customer.delete({ where: { id: "x" } })).rejects.toBeInstanceOf(HardDeleteError);
    await expect(client.contact.deleteMany({})).rejects.toBeInstanceOf(HardDeleteError);
    await expect(client.user.delete({ where: { id: "x" } })).rejects.toThrow(/Hard deletes are not allowed/);
    await client.$disconnect();
  });

  it("the app has no DELETE routes and no delete calls in source", () => {
    const root = path.resolve(__dirname, "../src");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name)) files.push(p);
      }
    };
    walk(root);
    const offenders = files.filter((f) => {
      const src = readFileSync(f, "utf8");
      return (
        /export\s+(async\s+)?function\s+DELETE\b/.test(src) ||
        /\b(db|tx|prisma|client)\.\w+\.(delete|deleteMany)\s*\(/.test(src) ||
        /\bDELETE\s+FROM\b/i.test(src)
      );
    });
    expect(offenders).toEqual([]);
  });
});
