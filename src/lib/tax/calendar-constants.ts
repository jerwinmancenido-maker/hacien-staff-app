// Tax calendar (Part 7d+) — deadlines for HACIEN under confirmed owner rules.
//
// Dates follow BIR rules (weekend/holiday roll per RMC 65-2016). Check with
// your accountant if unsure. This app never files, pays, or sends anything to
// BIR / eBIRForms. Do NOT add the 0605 annual registration fee (abolished).

/** Page banner on every tax calendar view (replaces per-row “Unverified: ask RDO”). */
export const TAX_CALENDAR_RULES_BANNER =
  "Dates follow BIR rules. Check with your accountant if unsure.";

/**
 * Shown until Settings → Tax calendar → "COR uploaded and checked" is on.
 * Kept as a secondary provisional notice; the rules banner always shows.
 */
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

/** Overdue section (above Next 90 days). */
export const TAX_CALENDAR_OVERDUE_SECTION_TITLE = "Overdue, not marked filed";
export const TAX_CALENDAR_OVERDUE_SECTION_HINT = "Already filed? Mark as done.";

/** Toggle label for forms that do not apply. */
export const TAX_CALENDAR_SHOW_NOT_APPLICABLE = "Show forms that don't apply";

/** Status labels shown on each row (exact wording). */
export const TAX_CALENDAR_STATUS = {
  upcoming: "Upcoming",
  dueIn7: "Due in 7 days",
  dueIn2: "Due in 2 days",
  overdue: "Overdue",
  markedDone: "Marked done",
} as const;

export type TaxCalendarStatusKey = keyof typeof TAX_CALENDAR_STATUS;

/** Applies? tag labels. “Unverified: ask RDO” is removed from rows (see page banner). */
export const TAX_CALENDAR_APPLIES = {
  confirmed: "Confirmed",
  /** Kept for settings/catalog typing; never shown on a row. */
  unverified: "",
  does_not_apply: "Does not apply",
} as const;

export type TaxCalendarAppliesKey = keyof typeof TAX_CALENDAR_APPLIES;

/** Prefix for the weekend/holiday-safe filing hint. */
export const TAX_CALENDAR_FILE_BY_PREFIX = "File by ";
export const TAX_CALENDAR_FILE_BY_SUFFIX = " to be safe";

/** Shown when an obligation has no due date yet. */
export const TAX_CALENDAR_DATE_TO_CONFIRM = "date to confirm";

/** 2551Q note under the 8% option (does not apply). */
export const TAX_CALENDAR_2551Q_NOTE = "Does not apply under the 8% income tax method";

/** 2550Q VAT note (non-VAT entity). */
export const TAX_CALENDAR_2550Q_NOTE =
  "Does not apply (non-VAT). COR may still show VAT — ask RDO before filing.";

/** Source note for confirmed 1701Q / annual from documents on hand. */
export const TAX_CALENDAR_CONFIRMED_FROM_DOCS_NOTE =
  "Confirmed from documents on hand (not COR).";

/** Source note for withholding-related items. */
export const TAX_CALENDAR_WITHHOLDING_SOURCE_NOTE =
  "Only if registered to withhold. Hidden by default.";

/** Source note for books / inventory year-end items. */
export const TAX_CALENDAR_BOOKS_SOURCE_NOTE =
  "Books of accounts due Jan 15 (loose-leaf) or Jan 30 (computerized), rolled to the next working day. Date left blank until books type is chosen.";

/** SAWT task attached to a quarter return when 2307s exist. */
export const TAX_CALENDAR_SAWT_TASK = "Send SAWT with this return";
export const TAX_CALENDAR_SAWT_PLAIN_NAME = "List of 2307s you received";

/** Plain names under form codes (exact wording). */
export const TAX_CALENDAR_PLAIN_NAMES: Record<string, string> = {
  "1701Q": "Quarterly income tax",
  "2551Q": "Quarterly percentage tax (3%)",
  "1701A": "Annual income tax",
  SAWT: TAX_CALENDAR_SAWT_PLAIN_NAME,
};

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

/** Horizon for the default "Upcoming" list (days) — today through today+90 inclusive. */
export const TAX_CALENDAR_UPCOMING_DAYS = 90;

/** Income tax method labels. */
export const INCOME_TAX_METHOD = {
  EIGHT_PERCENT: "EIGHT_PERCENT",
  GRADUATED: "GRADUATED",
} as const;

export type IncomeTaxMethod = (typeof INCOME_TAX_METHOD)[keyof typeof INCOME_TAX_METHOD];

export const INCOME_TAX_METHOD_LABELS: Record<IncomeTaxMethod, string> = {
  EIGHT_PERCENT: "8%",
  GRADUATED: "Graduated",
};

/** Books of accounts type. */
export const BOOKS_OF_ACCOUNTS_TYPE = {
  loose_leaf: "loose_leaf",
  computerized: "computerized",
} as const;

export type BooksOfAccountsType = (typeof BOOKS_OF_ACCOUNTS_TYPE)[keyof typeof BOOKS_OF_ACCOUNTS_TYPE];

export const BOOKS_OF_ACCOUNTS_TYPE_LABELS: Record<BooksOfAccountsType, string> = {
  loose_leaf: "Loose-leaf",
  computerized: "Computerized",
};
