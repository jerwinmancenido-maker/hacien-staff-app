import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { ESLint } from "eslint";
import { assertNotDelete, assertNotRawDelete, HardDeleteError, noDeleteExtension, rawSqlText } from "@/lib/no-delete";
import { proveNestedDifferentModelDeleteBlocked } from "@/lib/services/document-delete";

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

  it("assertNotRawDelete blocks raw SQL DELETE/TRUNCATE but allows other raw SQL", () => {
    expect(() => assertNotRawDelete("$executeRaw", { strings: ["DELETE FROM Customer WHERE id = ", ""], values: ["x"] })).toThrow(HardDeleteError);
    expect(() => assertNotRawDelete("$executeRawUnsafe", ["delete from `Contact`"])).toThrow(HardDeleteError);
    expect(() => assertNotRawDelete("$queryRawUnsafe", ["TRUNCATE TABLE AuditLog"])).toThrow(HardDeleteError);
    expect(() => assertNotRawDelete("$queryRaw", { strings: ["SELECT id FROM `User` FOR UPDATE"], values: [] })).not.toThrow();
    // Bound values are data, not SQL.
    expect(() => assertNotRawDelete("$queryRaw", { strings: ["SELECT * FROM Customer WHERE name = ", ""], values: ["delete"] })).not.toThrow();
    expect(rawSqlText(["SELECT 1", 2])).toBe("SELECT 1");
  });

  it("the extended Prisma client throws on raw SQL DELETE before touching the database", async () => {
    const client = new PrismaClient({ datasourceUrl: "mysql://nobody:nothing@127.0.0.1:1/none" }).$extends(noDeleteExtension);
    const id = "x";
    await expect(client.$executeRaw`DELETE FROM Customer WHERE id = ${id}`).rejects.toBeInstanceOf(HardDeleteError);
    await expect(client.$executeRawUnsafe("DELETE FROM Contact")).rejects.toBeInstanceOf(HardDeleteError);
    await expect(client.$queryRawUnsafe("truncate table Supplier")).rejects.toBeInstanceOf(HardDeleteError);
    // A harmless raw query passes the guard and fails only on the (unreachable) connection.
    await expect(client.$queryRaw`SELECT 1`).rejects.not.toBeInstanceOf(HardDeleteError);
    await client.$disconnect();
  });

  it("ESLint flags raw SQL DELETE and DELETE route handlers in app source", async () => {
    const eslint = new ESLint({ cwd: path.resolve(__dirname, "..") });
    const code = [
      'import { db } from "@/lib/db";',
      "export async function purge(id: string) {",
      "  await db.$executeRaw`DELETE FROM Customer WHERE id = ${id}`;",
      '  await db.$executeRawUnsafe("truncate table Contact");',
      "  await db.$queryRaw`SELECT id FROM \\`User\\` FOR UPDATE`;",
      "}",
      "export async function DELETE() {}",
      "",
    ].join("\n");
    const results = await eslint.lintText(code, { filePath: path.resolve(__dirname, "../src/lib/zz-lint-probe.ts") });
    const lines = (results[0]?.messages ?? []).filter((m) => m.ruleId === "no-restricted-syntax").map((m) => m.line);
    expect(lines).toEqual([3, 4, 7]);
  }, 30_000);

  it("the app has no DELETE routes and no delete calls outside the delete service", () => {
    const root = path.resolve(__dirname, "../src");
    const service = "src/lib/services/document-delete.ts";
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
      const rel = path.relative(path.resolve(__dirname, ".."), f).split(path.sep).join("/");
      const route = /export\s+(async\s+)?function\s+DELETE\b/.test(src);
      const raw = /\bDELETE\s+FROM\b/i.test(src);
      const call = /\b(db|tx|prisma|client)\.\w+\.(delete|deleteMany)\s*\(/.test(src);
      if (rel === service) {
        // Prisma delete only, in this one file. No deleteMany and no raw DELETE.
        return route || raw || /\.deleteMany\s*\(/.test(src) || !call;
      }
      return route || raw || call;
    });
    expect(offenders).toEqual([]);
  });

  it("only the delete service holds the private allowance", () => {
    const root = path.resolve(__dirname, "../src");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && readFileSync(p, "utf8").includes("new AsyncLocalStorage")) {
          hits.push(path.relative(path.resolve(__dirname, ".."), p).split(path.sep).join("/"));
        }
      }
    };
    walk(root);
    expect(hits).toEqual(["src/lib/no-delete.ts"]);
    const src = readFileSync(path.resolve(__dirname, "../src/lib/services/document-delete.ts"), "utf8");
    expect(src).not.toMatch(/export function inDocumentDelete/);
    expect(src).not.toMatch(/export (const|function) allowance/);
  });

  it("the allowance gate is key-locked: no exported runner, and the key has exactly two importers", () => {
    const noDelete = readFileSync(path.resolve(__dirname, "../src/lib/no-delete.ts"), "utf8");
    expect(noDelete).not.toMatch(/export\s+(async\s+)?function\s+withDeleteAllowance\b/);
    expect(noDelete).not.toMatch(/export\s+const\s+withDeleteAllowance\b/);
    expect(noDelete).toContain("deleteAllowanceGate");
    const root = path.resolve(__dirname, "../src");
    const importers: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && readFileSync(p, "utf8").includes("delete-allowance-key")) {
          importers.push(path.relative(path.resolve(__dirname, ".."), p).split(path.sep).join("/"));
        }
      }
    };
    walk(root);
    expect(importers.sort()).toEqual(["src/lib/no-delete.ts", "src/lib/services/document-delete.ts"]);
  });

  it("a nested delete of a different model still throws inside the allowance", async () => {
    const result = await proveNestedDifferentModelDeleteBlocked();
    expect(result).toEqual({
      quoteBlockedOutside: true,
      quoteAllowedInside: true,
      otherBlockedInside: true,
      nestedOtherBlocked: true,
      deleteManyBlockedInside: true,
    });
  });
});
