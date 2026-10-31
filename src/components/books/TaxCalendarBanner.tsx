import {
  TAX_CALENDAR_PROVISIONAL_BANNER,
  TAX_CALENDAR_RULES_BANNER,
} from "@/lib/tax/calendar-constants";

/**
 * One calm notice block: BIR rules, optional missing-holidays line, optional provisional.
 * Visual only — does not change due-date logic.
 */
export function TaxCalendarBanner({
  provisional,
  missingHolidaysLine = null,
}: {
  provisional: boolean;
  /** Combined "Holidays not set for …" line, or null when every year has holidays. */
  missingHolidaysLine?: string | null;
}) {
  return (
    <aside className="tax-cal-notice" role="status">
      <p className="tax-cal-notice-line">{TAX_CALENDAR_RULES_BANNER}</p>
      {missingHolidaysLine ? (
        <p className="tax-cal-notice-line">{missingHolidaysLine}</p>
      ) : null}
      {provisional ? (
        <p className="tax-cal-notice-line tax-cal-notice-provisional">{TAX_CALENDAR_PROVISIONAL_BANNER}</p>
      ) : null}
    </aside>
  );
}
