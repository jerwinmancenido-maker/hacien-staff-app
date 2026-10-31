import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import {
  TAX_CALENDAR_DISCLAIMER,
  TAX_CALENDAR_DUE_UNCONFIRMED_NOTE,
  TAX_CALENDAR_EMPTY_ALL,
  TAX_CALENDAR_EMPTY_UPCOMING,
  TAX_CALENDAR_OVERDUE_SECTION_HINT,
  TAX_CALENDAR_OVERDUE_SECTION_TITLE,
  TAX_CALENDAR_PAGE,
  TAX_CALENDAR_SHOW_NOT_APPLICABLE,
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
  // N/A rows never get Mark as done.
  if (r.notApplicable) return <span className="faint small">—</span>;
  return (
    <TaxCalendarMarkDoneForm
      occurrenceKey={r.occurrenceKey}
      dueYmd={r.dueYmd}
      defaultDoneDate={doneDefault}
      markedDone={r.markedDone}
      doneDateYmd={r.doneDateYmd}
      doneNote={r.doneNote}
      secondary={r.applies === "does_not_apply" || r.greyedOut}
    />
  );
}

function AppliesChip({ r }: { r: TaxCalendarRow }) {
  // Never show empty / “Unverified: ask RDO” on rows.
  if (!r.appliesLabel || r.applies === "unverified") return null;
  return <Chip tone={APPLIES_TONE[r.applies] ?? "grey"}>{r.appliesLabel}</Chip>;
}

function StatusChip({ r }: { r: TaxCalendarRow }) {
  return <Chip tone={STATUS_TONE[r.status] ?? "grey"}>{r.statusLabel}</Chip>;
}

function RowTasks({ r }: { r: TaxCalendarRow }) {
  if (!r.tasks.length) return null;
  return (
    <ul className="tax-cal-tasks" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
      {r.tasks.map((t) => (
        <li key={t} className="small">
          {t}
        </li>
      ))}
    </ul>
  );
}

function MobileCards({
  rows,
  doneDefault,
}: {
  rows: TaxCalendarRow[];
  doneDefault: string;
}) {
  return (
    <div className="tax-cal-mobile" role="list">
      {rows.map((r) => {
        const doesNotApply = r.notApplicable || r.applies === "does_not_apply" || r.greyedOut;
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
            <RowTasks r={r} />
            <div className="tax-cal-card-period">{r.periodLabel}</div>
            <div className="tax-cal-card-due">{r.dueDisplay}</div>
            {r.dueUnconfirmed ? (
              <div className="faint small">{TAX_CALENDAR_DUE_UNCONFIRMED_NOTE}</div>
            ) : null}
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
  );
}

function DesktopTable({
  rows,
  doneDefault,
}: {
  rows: TaxCalendarRow[];
  doneDefault: string;
}) {
  return (
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
  );
}

function Section({
  title,
  hint,
  rows,
  doneDefault,
  emptyTitle,
  emptyLine,
}: {
  title?: string;
  hint?: string;
  rows: TaxCalendarRow[];
  doneDefault: string;
  emptyTitle: string;
  emptyLine: string;
}) {
  return (
    <section style={{ marginBottom: 24 }}>
      {title ? (
        <div style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0, fontSize: "1.1rem" }}>{title}</h2>
          {hint ? <p className="faint small" style={{ margin: "4px 0 0" }}>{hint}</p> : null}
        </div>
      ) : null}
      {rows.length === 0 ? (
        <div className="card">
          <EmptyState title={emptyTitle} line={emptyLine} />
        </div>
      ) : (
        <>
          <MobileCards rows={rows} doneDefault={doneDefault} />
          <DesktopTable rows={rows} doneDefault={doneDefault} />
        </>
      )}
    </section>
  );
}

export default async function TaxCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; showNa?: string }>;
}) {
  const user = await requirePagePermission("view_books");
  const sp = await searchParams;
  const view = sp.view === "all" ? "all" : "upcoming";
  const showNotApplicable = sp.showNa === "1" || sp.showNa === "true";
  const { rows, overdue, provisional, missingHolidaysLine } = await listTaxCalendar(user, {
    view,
    showNotApplicable,
  });
  const canExport = can(user, "manage_settings");
  const doneDefault = defaultDoneDateYmd();

  const showNaHref =
    view === "all"
      ? `/books/tax/calendar?view=all${showNotApplicable ? "" : "&showNa=1"}`
      : `/books/tax/calendar${showNotApplicable ? "" : "?showNa=1"}`;
  const hideNaHref = view === "all" ? "/books/tax/calendar?view=all" : "/books/tax/calendar";

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
      <TaxCalendarBanner provisional={provisional} missingHolidaysLine={missingHolidaysLine} />

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <nav aria-label="Calendar view" style={{ display: "flex", gap: 8 }} role="tablist">
            <Link
              className={`btn btn-sm${view === "upcoming" ? "" : " btn-secondary"}`}
              href={showNotApplicable ? "/books/tax/calendar?showNa=1" : "/books/tax/calendar"}
              role="tab"
              aria-selected={view === "upcoming"}
            >
              Next 90 days
            </Link>
            <Link
              className={`btn btn-sm${view === "all" ? "" : " btn-secondary"}`}
              href={showNotApplicable ? "/books/tax/calendar?view=all&showNa=1" : "/books/tax/calendar?view=all"}
              role="tab"
              aria-selected={view === "all"}
            >
              All
            </Link>
          </nav>
          <Link
            className={`btn btn-sm${showNotApplicable ? "" : " btn-secondary"}`}
            href={showNotApplicable ? hideNaHref : showNaHref}
          >
            {TAX_CALENDAR_SHOW_NOT_APPLICABLE}
          </Link>
          <span className="faint small">
            Due dates in Asia/Manila (PHT). Mark as done is a staff note only — not a filing.
          </span>
        </div>
      </div>

      {view === "upcoming" ? (
        <>
          {overdue.length > 0 ? (
            <Section
              title={TAX_CALENDAR_OVERDUE_SECTION_TITLE}
              hint={TAX_CALENDAR_OVERDUE_SECTION_HINT}
              rows={overdue}
              doneDefault={doneDefault}
              emptyTitle="No overdue items"
              emptyLine="Nothing past due that still needs a mark-as-done note."
            />
          ) : null}
          <Section
            title="Next 90 days"
            hint="Today through today + 90 days."
            rows={rows}
            doneDefault={doneDefault}
            emptyTitle="No upcoming deadlines"
            emptyLine={TAX_CALENDAR_EMPTY_UPCOMING}
          />
        </>
      ) : rows.length === 0 ? (
        <div className="card">
          <EmptyState title="Nothing on the calendar" line={TAX_CALENDAR_EMPTY_ALL} />
        </div>
      ) : (
        <>
          <MobileCards rows={rows} doneDefault={doneDefault} />
          <DesktopTable rows={rows} doneDefault={doneDefault} />
        </>
      )}
    </>
  );
}
