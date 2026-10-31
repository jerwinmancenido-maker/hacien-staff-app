import {
  TAX_CALENDAR_PROVISIONAL_BANNER,
  TAX_CALENDAR_RULES_BANNER,
} from "@/lib/tax/calendar-constants";

/** Always show the BIR rules banner; provisional COR note until COR is checked. */
export function TaxCalendarBanner({
  provisional,
  missingHolidayBanners = [],
}: {
  provisional: boolean;
  /** One line per year with no holiday list (e.g. 2025 / 2027). */
  missingHolidayBanners?: readonly string[];
}) {
  return (
    <>
      <div className="alert warn" role="status" style={{ marginBottom: 12 }}>
        <b>{TAX_CALENDAR_RULES_BANNER}</b>
      </div>
      {missingHolidayBanners.map((line) => (
        <div key={line} className="alert warn" role="status" style={{ marginBottom: 12 }}>
          <b>{line}</b>
        </div>
      ))}
      {provisional ? (
        <div className="alert warn" role="status" style={{ marginBottom: 16 }}>
          <b>{TAX_CALENDAR_PROVISIONAL_BANNER}</b>
        </div>
      ) : null}
    </>
  );
}
