import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import {
  TAX_CALENDAR_DISCLAIMER,
  TAX_CALENDAR_EMPTY_ALL,
  TAX_CALENDAR_EMPTY_UPCOMING,
  TAX_CALENDAR_PAGE,
} from "@/lib/tax/calendar-constants";
import { defaultDoneDateYmd, listTaxCalendar } from "@/lib/services/tax-calendar";
import type { TaxCalendarRow } from "@/lib/tax/calendar-build";
import { BooksNav } from "@/components/books/BooksNav";
import { TaxCalendarBanner } from "@/components/books/TaxCalendarBanner";
import { TaxCalendarMarkDoneForm } from "@/components/books/TaxCalendarMarkDoneForm";
import { TaxCalendarDesktopBody } from "@/components/books/TaxCalendarDesktopBody";
import { Chip, EmptyState, PageHeader, type ChipTone } from "@/components/ui";

const STATUS_TONE: Record<string, ChipTone> = {
  upcoming: "grey",
  dueIn7: "amber",
  dueIn2: "amber",
  overdue: "red",
  markedDone: "green",
};

const APPLIES_TONE: Record<string, ChipTone> = {
  confirmed: "green",
  unverified: "amber",
  does_not_apply: "grey",
};

function MarkDone({
  r,
  doneDefault,
}: {
  r: TaxCalendarRow;
  doneDefault: string;
}) {
  return (
    <TaxCalendarMarkDoneForm
      occurrenceKey={r.occurrenceKey}
      dueYmd={r.dueYmd}
      defaultDoneDate={doneDefault}
      markedDone={r.markedDone}
      doneDateYmd={r.doneDateYmd}
      doneNote={r.doneNote}
      // Does-not-apply rows: outline so faded opacity doesn't look like a disabled control.
      secondary={r.applies === "does_not_apply" || r.greyedOut}
    />
  );
}

function AppliesChip({ r }: { r: TaxCalendarRow }) {
  return <Chip tone={APPLIES_TONE[r.applies] ?? "grey"}>{r.appliesLabel}</Chip>;
}

function StatusChip({ r }: { r: TaxCalendarRow }) {
  return <Chip tone={STATUS_TONE[r.status] ?? "grey"}>{r.statusLabel}</Chip>;
}

export default async function TaxCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const user = await requirePagePermission("view_books");
  const sp = await searchParams;
  const view = sp.view === "all" ? "all" : "upcoming";
  const { rows, provisional } = await listTaxCalendar(user, { view });
  const canExport = can(user, "manage_settings");
  const doneDefault = defaultDoneDateYmd();

  return (
    <>
      <PageHeader
        title={TAX_CALENDAR_PAGE.title}
        subtitle={TAX_CALENDAR_DISCLAIMER}
        actions={
          canExport ? (
            <Link className="btn" href="/books/tax/calendar/export.ics">
              Download .ics
            </Link>
          ) : null
        }
      />
      <BooksNav active="tax-calendar" />
      <TaxCalendarBanner provisional={provisional} />

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <nav aria-label="Calendar view" style={{ display: "flex", gap: 8 }} role="tablist">
            <Link
              className={`btn btn-sm${view === "upcoming" ? "" : " btn-secondary"}`}
              href="/books/tax/calendar"
              role="tab"
              aria-selected={view === "upcoming"}
            >
              Next 90 days
            </Link>
            <Link
              className={`btn btn-sm${view === "all" ? "" : " btn-secondary"}`}
              href="/books/tax/calendar?view=all"
              role="tab"
              aria-selected={view === "all"}
            >
              All
            </Link>
          </nav>
          <span className="faint small">
            Due dates in Asia/Manila (PHT). Mark as done is a staff note only — not a filing.
          </span>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="card">
          <EmptyState
            title={view === "all" ? "Nothing on the calendar" : "No upcoming deadlines"}
            line={view === "all" ? TAX_CALENDAR_EMPTY_ALL : TAX_CALENDAR_EMPTY_UPCOMING}
          />
        </div>
      ) : (
        <>
          {/* Phone (below sm / 640px): one stacked card per obligation — same fields as the table. */}
          <div className="tax-cal-mobile" role="list">
            {rows.map((r) => {
              const doesNotApply = r.applies === "does_not_apply" || r.greyedOut;
              return (
                <div
                  key={r.occurrenceKey}
                  className={`card tax-cal-card${doesNotApply ? " tax-cal-card-muted" : ""}`}
                  role="listitem"
                >
                  {doesNotApply ? (
                    <div className="tax-cal-card-chips">
                      <AppliesChip r={r} />
                    </div>
                  ) : null}
                  <div className="tax-cal-card-name">
                    <b>{r.form}</b>
                    <span className="tax-cal-card-desc">{r.description}</span>
                  </div>
                  <div className="tax-cal-card-period">{r.periodLabel}</div>
                  <div className="tax-cal-card-due">{r.dueDisplay}</div>
                  {r.fileByHint ? <div className="faint small">{r.fileByHint}</div> : null}
                  <div className="tax-cal-card-chips">
                    <StatusChip r={r} />
                    {!doesNotApply ? <AppliesChip r={r} /> : null}
                  </div>
                  {r.appliesNote ? <div className="faint small">{r.appliesNote}</div> : null}
                  {r.worksheetLink ? (
                    <div className="tax-cal-card-worksheet">
                      <Link href={r.worksheetLink}>Open worksheet</Link>
                    </div>
                  ) : null}
                  <div className="tax-cal-card-action">
                    <MarkDone r={r} doneDefault={doneDefault} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop (sm+): fit without horizontal clip at 1024 / 1280. */}
          <div className="card tax-cal-desktop">
            <table className="list tax-cal-table">
              <thead>
                <tr>
                  <th>Form</th>
                  <th>Description</th>
                  <th>Period</th>
                  <th>Due (PHT)</th>
                  <th>Status</th>
                  <th>Applies?</th>
                  <th>Worksheet</th>
                  <th>Done</th>
                </tr>
              </thead>
              <TaxCalendarDesktopBody rows={rows} doneDefault={doneDefault} />
            </table>
          </div>
        </>
      )}
    </>
  );
}
