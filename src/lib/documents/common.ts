// Helpers shared by the quote and sales order services.

import { Prisma } from "@prisma/client";
import type { WithholdingSnapshot } from "../quotes/calc";

/** A business rule stopped the action (shown to the user as a form message). */
export class DocRuleError extends Error {
  constructor(
    message: string,
    public field?: string,
  ) {
    super(message);
    this.name = "DocRuleError";
  }
}

/** Document transactions wait for the number-series row lock, so allow more time than Prisma's 2s/5s defaults. */
export const DOC_TX = { maxWait: 15_000, timeout: 30_000 } as const;

/** InnoDB deadlock / lock wait timeout: safe to retry the whole transaction. */
function isRetryable(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (e.code === "P2034") return true;
  const dbCode = String((e.meta as { code?: unknown } | undefined)?.code ?? "");
  return e.code === "P2010" && (dbCode === "1213" || dbCode === "1205");
}

export async function withTxRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= attempts || !isRetryable(e)) throw e;
      await new Promise((r) => setTimeout(r, 20 * i + Math.floor(Math.random() * 30)));
    }
  }
}

/** Prisma Decimal (or number/string) → fixed 2-decimal string. */
export function money(d: { toFixed(n: number): string } | number | string): string {
  if (typeof d === "string") return Number(d).toFixed(2);
  return d.toFixed(2);
}

export function ymd(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

type ItemRow = {
  sortOrder: number;
  description: string;
  kind: string;
  qty: { toFixed(n: number): string };
  unit: string;
  supplierId: string | null;
  supplierUnitCost: { toFixed(n: number): string };
  unitPrice: { toFixed(n: number): string };
  total: { toFixed(n: number): string };
  supplierTotal: { toFixed(n: number): string };
  margin: { toFixed(n: number): string };
};

/** Compact item list for audit before/after (cost fields are stripped on display for non-cost users). */
export function auditItems(items: readonly ItemRow[]) {
  return [...items]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((i) => ({
      description: i.description,
      kind: i.kind,
      qty: money(i.qty),
      unit: i.unit,
      unitPrice: money(i.unitPrice),
      total: money(i.total),
      supplierId: i.supplierId,
      supplierUnitCost: money(i.supplierUnitCost),
      supplierTotal: money(i.supplierTotal),
      margin: money(i.margin),
    }));
}

export function withholdingCodes(snapshot: readonly WithholdingSnapshot[]): string {
  return snapshot.map((w) => w.code).join(", ");
}
