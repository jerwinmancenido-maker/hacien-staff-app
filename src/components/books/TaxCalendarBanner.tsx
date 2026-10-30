import { TAX_CALENDAR_PROVISIONAL_BANNER } from "@/lib/tax/calendar-constants";

/** Always shown until Settings → Tax calendar → COR uploaded and checked. */
export function TaxCalendarBanner({ provisional }: { provisional: boolean }) {
  if (!provisional) return null;
  return (
    <div className="alert warn" role="status" style={{ marginBottom: 16 }}>
      <b>{TAX_CALENDAR_PROVISIONAL_BANNER}</b>
    </div>
  );
}
