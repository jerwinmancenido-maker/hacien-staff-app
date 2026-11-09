import type { PermissionUser } from "../permissions";
import { canSeeTin, stripCosts } from "../permissions";
import { resolveCustomerSavedPick } from "../quotes/withholding-defaults";
import { CompanyRuleError, getCustomer, listCustomers, loadCustomerWriteOptions, saveCustomer } from "../services/companies";
import { customerSchema } from "../validation/companies";
import { zodFieldErrors } from "../validation/forms";
import type { ApiActor } from "./keys";
import { ApiError } from "./errors";
import { decimalString, parsePageLimit } from "./http";

type Money = { toFixed: (n: number) => string } | null;

export type CustomerShape = {
  id: string;
  name: string;
  tin: string | null;
  withholdingType: string;
  defaultWithholding: unknown;
  defaultTerms: string | null;
  creditLimit: Money;
  notes: string | null;
  isIndividual: boolean;
  orderTextUpdates: boolean;
  active: boolean;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export function serializeCustomer(row: CustomerShape, user: PermissionUser): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: row.id,
    name: row.name,
    withholdingType: row.withholdingType,
    defaultWithholding: row.defaultWithholding ?? null,
    defaultTerms: row.defaultTerms,
    creditLimit: decimalString(row.creditLimit),
    notes: row.notes,
    isIndividual: row.isIndividual,
    orderTextUpdates: row.orderTextUpdates,
    active: row.active,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  if (canSeeTin(user)) out.tin = row.tin;
  return stripCosts(out, user);
}

export async function listCustomersForApi(search: URLSearchParams, user: PermissionUser) {
  const page = parsePageLimit(search);
  if (!page.ok) throw new ApiError(400, "validation", page.error);
  const q = search.get("q")?.trim() ?? "";
  if (q.length > 100) throw new ApiError(400, "validation", "Search must be 100 characters or less.");
  const rows = await listCustomers({
    q: q || undefined,
    // Staff list passes matchTin from canSeeTin. Viewers search names only,
    // so a hidden TIN cannot be used to find whose it is.
    matchTin: canSeeTin(user),
    skip: (page.page - 1) * page.limit,
    take: page.limit + 1,
  });
  const hasMore = rows.length > page.limit;
  return {
    customers: rows.slice(0, page.limit).map((row) => serializeCustomer(row, user)),
    page: page.page,
    limit: page.limit,
    hasMore,
  };
}

export async function getCustomerForApi(id: string, user: PermissionUser) {
  const row = await getCustomer(id);
  if (!row) throw new ApiError(404, "not_found", "Customer not found.");
  return { customer: serializeCustomer(row, user) };
}

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (value == null) return "";
  return "";
}

function overlayCustomer(existing: CustomerShape, raw: Record<string, unknown>): Record<string, unknown> {
  return {
    name: raw.name !== undefined ? raw.name : existing.name,
    tin: raw.tin !== undefined ? raw.tin : (existing.tin ?? ""),
    withholdingType: raw.withholdingType !== undefined ? raw.withholdingType : existing.withholdingType,
    defaultWithholding: raw.defaultWithholding !== undefined ? raw.defaultWithholding : existing.defaultWithholding,
    defaultTerms: raw.defaultTerms !== undefined ? raw.defaultTerms : (existing.defaultTerms ?? ""),
    creditLimit: raw.creditLimit !== undefined ? raw.creditLimit : decimalString(existing.creditLimit) ?? "",
    notes: raw.notes !== undefined ? raw.notes : (existing.notes ?? ""),
    isIndividual: raw.isIndividual !== undefined ? raw.isIndividual : existing.isIndividual,
    orderTextUpdates: raw.orderTextUpdates !== undefined ? raw.orderTextUpdates : existing.orderTextUpdates,
  };
}

function schemaInput(merged: Record<string, unknown>) {
  const withholdingType = merged.withholdingType;
  const rawPick = merged.defaultWithholding;
  const pick = Array.isArray(rawPick) ? rawPick.filter((x): x is string => typeof x === "string") : null;
  return {
    name: asString(merged.name),
    tin: asString(merged.tin),
    withholdingType,
    defaultWithholding: resolveCustomerSavedPick(typeof withholdingType === "string" ? withholdingType : undefined, rawPick === undefined ? undefined : pick),
    defaultTerms: asString(merged.defaultTerms),
    ...(merged.creditLimit === undefined ? {} : { creditLimit: merged.creditLimit == null ? "" : asString(merged.creditLimit) }),
    notes: merged.notes == null ? "" : asString(merged.notes),
    isIndividual: typeof merged.isIndividual === "boolean" ? merged.isIndividual : undefined,
    orderTextUpdates: typeof merged.orderTextUpdates === "boolean" ? merged.orderTextUpdates : undefined,
  };
}

/** Create or full/partial update through saveCustomer. id null creates. */
export async function writeCustomer(id: string | null, body: unknown, actor: ApiActor): Promise<CustomerShape> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(400, "validation", "Send a JSON object.");
  }
  const raw = body as Record<string, unknown>;
  let merged: Record<string, unknown> = raw;
  if (id) {
    const existing = await getCustomer(id);
    if (!existing) throw new ApiError(404, "not_found", "Customer not found.");
    merged = overlayCustomer(existing, raw);
  }
  const rules = await loadCustomerWriteOptions(id);
  const parsed = customerSchema(rules.allowedTerms, rules.activeCodes, rules.termsRequired).safeParse(schemaInput(merged));
  if (!parsed.success) {
    throw new ApiError(400, "validation", "Fix the fields marked below.", zodFieldErrors(parsed.error));
  }
  try {
    return await saveCustomer(id, parsed.data, { id: actor.id, isAdmin: actor.isAdmin });
  } catch (e) {
    if (e instanceof CompanyRuleError) {
      throw new ApiError(409, "rule", e.message, e.field ? { [e.field]: e.message } : undefined);
    }
    throw e;
  }
}
