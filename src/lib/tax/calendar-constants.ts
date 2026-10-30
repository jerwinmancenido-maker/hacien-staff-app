// Tax calendar (Part 7d) — provisional deadlines for HACIEN.
//
// UNVERIFIED — built from documents on hand, not the BIR COR. Confirm every
// obligation and date with the accountant / RDO before relying on them.
// This app never files, pays, or sends anything to BIR / eBIRForms.
// Do NOT add the 0605 annual registration fee (abolished).

/** Shown until Settings → Tax calendar → "COR uploaded and checked" is on. */
export const TAX_CALENDAR_PROVISIONAL_BANNER =
  "Provisional: built from documents on hand, not the BIR COR. Check with your accountant or RDO before relying on these dates.";

/** Short page disclaimer under the title. */
export const TAX_CALENDAR_DISCLAIMER =
  "Read-only calendar of likely deadlines. Nothing is filed, paid, or sent by this app.";

/** Empty list copy (Upcoming 90 days). */
export const TAX_CALENDAR_EMPTY_UPCOMING =
  "No deadlines in the next 90 days for the obligations that are switched on.";

/** Empty list copy (All view). */
export const TAX_CALENDAR_EMPTY_ALL =
  "No calendar rows to show. Turn obligations on under Settings → Tax calendar, or ask the owner.";

/** Status labels shown on each row (exact wording). */
export const TAX_CALENDAR_STATUS = {
  upcoming: "Upcoming",
  dueIn7: "Due in 7 days",
  dueIn2: "Due in 2 days",
  overdue: "Overdue",
  markedDone: "Marked done",
} as const;

export type TaxCalendarStatusKey = keyof typeof TAX_CALENDAR_STATUS;

/** Applies? tag labels (exact wording). */
export const TAX_CALENDAR_APPLIES = {
  confirmed: "Confirmed",
  unverified: "Unverified: ask RDO",
  does_not_apply: "Does not apply",
} as const;

export type TaxCalendarAppliesKey = keyof typeof TAX_CALENDAR_APPLIES;

/** Prefix for the weekend-safe filing hint. Legal date stays unchanged. */
export const TAX_CALENDAR_FILE_BY_PREFIX = "File by ";
export const TAX_CALENDAR_FILE_BY_SUFFIX = " to be safe";

/** Shown when an obligation has no due date yet. */
export const TAX_CALENDAR_DATE_TO_CONFIRM = "date to confirm";

/** 2551Q greyed-out note under the 8% option. */
export const TAX_CALENDAR_2551Q_NOTE = "confirm 8% election with RDO";

/** 2550Q VAT note (non-VAT entity). */
export const TAX_CALENDAR_2550Q_NOTE =
  "COR may still show VAT. Ask RDO to correct; do not file without RDO advice.";

/** Source note for confirmed 1701Q / 1701 from documents on hand. */
export const TAX_CALENDAR_CONFIRMED_FROM_DOCS_NOTE = "Confirmed from documents on hand (not COR). UNVERIFIED until COR checked.";

/** Source note for withholding-related items. */
export const TAX_CALENDAR_WITHHOLDING_SOURCE_NOTE =
  "Unverified: ask RDO (only if registered to withhold). Hidden by default.";

/** Source note for books / inventory year-end items. */
export const TAX_CALENDAR_BOOKS_SOURCE_NOTE = "Unverified: ask RDO. Date left blank until confirmed.";

/** Nav / page copy. */
export const TAX_CALENDAR_PAGE = {
  key: "calendar" as const,
  label: "Tax calendar",
  title: "Tax calendar",
  href: "/books/tax/calendar",
  subtitle: TAX_CALENDAR_DISCLAIMER,
} as const;

/** ICS calendar name (no customer data). */
export const TAX_CALENDAR_ICS_NAME = "HACIEN tax deadlines (provisional)";
export const TAX_CALENDAR_ICS_FILENAME = "hacien-tax-calendar.ics";

/** Horizon for the default "Upcoming" list (days). */
export const TAX_CALENDAR_UPCOMING_DAYS = 90;
