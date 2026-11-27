"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { billingListHref, type BillingListSearch } from "@/lib/billing/list-href";

/**
 * Search + date-range filters for the Billings / Collections lists, in the
 * LedgerFilters shape: every control navigates immediately via the router —
 * there is no Filter button. Status lives in the pages filter chips (Links),
 * which share the same billingListHref param patching, so search, dates and
 * status thread each others params (Billings customerId included) and every
 * change restarts at page 1.
 */
export function BillingListFilters({
  basePath,
  searchPlaceholder,
  fromAriaLabel,
  toAriaLabel,
  current,
}: {
  basePath: string;
  searchPlaceholder: string;
  fromAriaLabel: string;
  toAriaLabel: string;
  current: BillingListSearch;
}) {
  const router = useRouter();
  // Handlers read the latest params through a ref: a debounced search must
  // patch over the params as they are when it fires, not as they were when
  // the user started typing.
  const currentRef = useRef(current);
  useEffect(() => {
    currentRef.current = current;
  });
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    },
    [],
  );

  const go = (patch: Partial<BillingListSearch>) =>
    router.push(billingListHref(basePath, currentRef.current, patch));

  const onSearchChange = (value: string) => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => go({ q: value || undefined }), 350);
  };

  const onDateChange = (key: "from" | "to", value: string) => {
    // A date input reports "" while a date is only partly typed; navigate
    // only on a complete date or a deliberate clear.
    if (value !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    go({ [key]: value || undefined });
  };

  return (
    <>
      <input
        className="input"
        name="q"
        defaultValue={current.q ?? ""}
        placeholder={searchPlaceholder}
        aria-label={searchPlaceholder}
        onChange={(e) => onSearchChange(e.target.value)}
      />
      <label className="small faint">
        From
        <input
          className="input"
          type="date"
          name="from"
          defaultValue={current.from ?? ""}
          aria-label={fromAriaLabel}
          onChange={(e) => onDateChange("from", e.target.value)}
        />
      </label>
      <label className="small faint">
        To
        <input
          className="input"
          type="date"
          name="to"
          defaultValue={current.to ?? ""}
          aria-label={toAriaLabel}
          onChange={(e) => onDateChange("to", e.target.value)}
        />
      </label>
    </>
  );
}
