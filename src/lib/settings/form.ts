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
  { key: "supplierPayment", label: "Supplier payments (internal)" },
  { key: "expense", label: "Expenses (internal)" },
  { key: "cashTransfer", label: "Cash transfers (internal)" },
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
    case "taxYear": {
      const yearRaw = (get("year") ?? "").trim();
      const yearNum = Number(yearRaw);
      const booksRaw = (get("booksType") ?? "").trim();
      const booksType =
        booksRaw === "loose_leaf" || booksRaw === "computerized" ? booksRaw : null;
      // Holiday lines: "YYYY-MM-DD" or "YYYY-MM-DD regular|special Optional name"
      const holidays = lines(get("holidays")).flatMap((line) => {
        if (line.startsWith("#")) return [];
        const parts = line.split(/\s+/);
        const ymd = parts[0] ?? "";
        if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return [];
        let kind: "regular" | "special" = "regular";
        let nameParts: string[] = [];
        if (parts[1] === "regular" || parts[1] === "special") {
          kind = parts[1];
          nameParts = parts.slice(2);
        } else if (parts.length > 1) {
          nameParts = parts.slice(1);
        }
        const name = nameParts.join(" ").trim();
        return name ? [{ ymd, kind, name }] : [{ ymd, kind }];
      });
      // Preserve years outside the visible selects (hidden prior map).
      const priorRaw = get("incomeTaxMethodsByYearPrior") ?? "";
      let incomeTaxMethodsByYear: Record<string, "EIGHT_PERCENT" | "GRADUATED"> = {};
      if (priorRaw.trim()) {
        try {
          const parsed = JSON.parse(priorRaw) as Record<string, string>;
          for (const [k, v] of Object.entries(parsed)) {
            if (v === "EIGHT_PERCENT" || v === "GRADUATED") incomeTaxMethodsByYear[k] = v;
          }
        } catch {
          // Invalid prior JSON is ignored; per-year selects still apply.
          incomeTaxMethodsByYear = {};
        }
      }
      // Per-year selects: methodByYear.YYYY
      const selectYearsRaw = (get("methodByYearYears") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      const selectYears = selectYearsRaw.length
        ? selectYearsRaw
        : Number.isInteger(yearNum)
          ? [String(yearNum - 1), String(yearNum), String(yearNum + 1)]
          : [];
      for (const y of selectYears) {
        const raw = (get(`methodByYear.${y}`) ?? "").trim();
        if (raw === "EIGHT_PERCENT" || raw === "GRADUATED") {
          incomeTaxMethodsByYear[y] = raw;
        }
      }
      const activeKey = Number.isInteger(yearNum) ? String(yearNum) : "";
      const fromActiveSelect = activeKey ? get(`methodByYear.${activeKey}`) : null;
      const incomeTaxMethod =
        fromActiveSelect === "GRADUATED" || fromActiveSelect === "EIGHT_PERCENT"
          ? fromActiveSelect
          : get("incomeTaxMethod") === "GRADUATED"
            ? "GRADUATED"
            : "EIGHT_PERCENT";
      if (activeKey) incomeTaxMethodsByYear[activeKey] = incomeTaxMethod;
      return {
        year: yearRaw,
        nonVatLimit: get("nonVatLimit"),
        warnFirstPct: get("warnFirstPct"),
        warnSecondPct: get("warnSecondPct"),
        incomeTaxMethod,
        incomeTaxMethodsByYear,
        holidays,
        booksType,
      };
    }
    case "company":
      return {
        name: get("name") ?? "",
        tradeName: get("tradeName") ?? "",
        tin: get("tin") ?? "",
        address: get("address") ?? "",
        phone: get("phone") ?? "",
        email: get("email") ?? "",
        website: get("website") ?? "",
        logoStorageKey: get("logoStorageKey") ?? "",
      };
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
    case "features":
      return {
        payablesEnabled: checked(get("payablesEnabled")),
        cashEnabled: checked(get("cashEnabled")),
        booksEnabled: checked(get("booksEnabled")),
        payables2307Enabled: checked(get("payables2307Enabled")),
      };
    case "taxCalendar": {
      const keys = [
        "1701q",
        "1701",
        "1701a",
        "2551q",
        "2550q",
        "0619e",
        "1601eq",
        "books_accounts",
        "inventory_list",
      ] as const;
      const optionalInt = (raw: string | null) => {
        const t = (raw ?? "").trim();
        if (!t) return null;
        return Number(t);
      };
      return {
        corUploadedAndChecked: checked(get("corUploadedAndChecked")),
        obligations: Object.fromEntries(
          keys.map((k) => [
            k,
            {
              enabled: checked(get(`obligations.${k}.enabled`)),
              dueDay: optionalInt(get(`obligations.${k}.dueDay`)),
              dueMonth: optionalInt(get(`obligations.${k}.dueMonth`)),
            },
          ]),
        ),
      };
    }
    case "print": {
      const bankCount = Math.max(0, Number(get("bankCount") ?? "0") || 0);
      const eWalletCount = Math.max(0, Number(get("eWalletCount") ?? "0") || 0);
      const banks = Array.from({ length: Math.min(bankCount, 5) }, (_, i) => ({
        bankName: get(`banks.${i}.bankName`) ?? "",
        accountName: get(`banks.${i}.accountName`) ?? "",
        accountLast4: get(`banks.${i}.accountLast4`) ?? "",
        printFullAccountNumber: checked(get(`banks.${i}.printFullAccountNumber`)),
        accountNumberFull: get(`banks.${i}.accountNumberFull`) ?? "",
      })).filter((b) => b.bankName || b.accountName || b.accountLast4 || b.accountNumberFull);
      const eWallets = Array.from({ length: Math.min(eWalletCount, 5) }, (_, i) => ({
        provider: get(`eWallets.${i}.provider`) ?? "",
        accountName: get(`eWallets.${i}.accountName`) ?? "",
        accountLast4: get(`eWallets.${i}.accountLast4`) ?? "",
        printFullAccountNumber: checked(get(`eWallets.${i}.printFullAccountNumber`)),
        accountNumberFull: get(`eWallets.${i}.accountNumberFull`) ?? "",
      })).filter((b) => b.provider || b.accountName || b.accountLast4 || b.accountNumberFull);
      return {
        paperSize: get("paperSize") ?? "A4",
        showInputTaxDisclaimer: checked(get("showInputTaxDisclaimer")),
        showReceivingReportCosts: checked(get("showReceivingReportCosts")),
        quoteTerms: get("quoteTerms") ?? "",
        deliveryNotes: get("deliveryNotes") ?? "",
        warrantyNotes: get("warrantyNotes") ?? "",
        banks,
        eWallets,
      };
    }
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
