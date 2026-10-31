import {
  TAX_CALENDAR_PROVISIONAL_BANNER,
  TAX_CALENDAR_RULES_BANNER,
} from "@/lib/tax/calendar-constants";

/** Always show the BIR rules banner; provisional COR note until COR is checked. */
export function TaxCalendarBanner({ provisional }: { provisional: boolean }) {
  return (
    <>
      <div className="alert warn" role="status" style={{ marginBottom: 12 }}>
        <b>{TAX_CALENDAR_RULES_BANNER}</b>
      </div>
      {provisional ? (
        <div className="alert warn" role="status" style={{ marginBottom: 16 }}>
          <b>{TAX_CALENDAR_PROVISIONAL_BANNER}</b>
        </div>
      ) : null}
    </>
  );
}
