// Builds a settings section value from a submitted form (input names are the
// field paths inside the section, e.g. "quote.prefix").

import type { SettingsKey } from "./schema";

type Get = (name: string) => string | null;

const lines = (v: string | null) =>
  (v ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

const checked = (v: string | null) => v === "on" || v === "true";

export const NUMBERED_DOCS = [
  { key: "quote", label: "Quotes" },
  { key: "salesOrder", label: "Sales orders" },
  { key: "supplierPo", label: "Supplier POs" },
  { key: "receivingReport", label: "Receiving reports" },
  { key: "billing", label: "Billings (internal)" },
  { key: "collection", label: "Collections (internal)" },
] as const;

export function settingsValueFromForm(key: SettingsKey, get: Get): unknown {
  switch (key) {
    case "approval":
      return { marginBelowPct: get("marginBelowPct"), totalAbove: get("totalAbove") };
    case "quotes":
      return { defaultValidityDays: get("defaultValidityDays") };
    case "numbering":
      return Object.fromEntries(
        NUMBERED_DOCS.map((d) => [
          d.key,
          {
            prefix: (get(`${d.key}.prefix`) ?? "").toUpperCase(),
            padding: get(`${d.key}.padding`),
            resetYearly: checked(get(`${d.key}.resetYearly`)),
          },
        ]),
      );
    case "taxYear":
      return {
        year: get("year"),
        nonVatLimit: get("nonVatLimit"),
        warnFirstPct: get("warnFirstPct"),
        warnSecondPct: get("warnSecondPct"),
      };
    case "company":
      return { name: get("name") ?? "", tin: get("tin") ?? "", address: get("address") ?? "" };
    case "lists":
      return { paymentTerms: lines(get("paymentTerms")), contactRoles: lines(get("contactRoles")) };
    case "documents":
      return { expiryWarningDays: get("expiryWarningDays") };
    case "invoiceBooklet":
      return {
        seriesFrom: get("seriesFrom"),
        seriesTo: get("seriesTo"),
        label: get("label") ?? "",
      };
    case "collections":
      return { overdueGraceDays: get("overdueGraceDays") };
  }
}

/** Flatten nested values to dotted keys, for showing changed leaves in the change log. */
export function flatten(value: unknown, prefix = ""): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value).reduce<Record<string, unknown>>(
      (acc, [k, v]) => ({ ...acc, ...flatten(v, prefix ? `${prefix}.${k}` : k) }),
      {},
    );
  }
  return { [prefix || "value"]: value };
}

export function changedLeaves(before: unknown, after: unknown) {
  const b = flatten(before);
  const a = flatten(after);
  return Array.from(new Set([...Object.keys(b), ...Object.keys(a)]))
    .filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]))
    .map((k) => ({ key: k, before: b[k], after: a[k] }));
}
