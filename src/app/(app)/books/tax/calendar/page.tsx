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
import { BooksNav } from "@/components/books/BooksNav";
import { TaxCalendarBanner } from "@/components/books/TaxCalendarBanner";
import { TaxCalendarMarkDoneForm } from "@/components/books/TaxCalendarMarkDoneForm";
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
          <nav aria-label="Calendar view" style={{ display: "flex", gap: 8 }}>
            <Link
              className={`btn btn-sm${view === "upcoming" ? " btn-primary" : ""}`}
              href="/books/tax/calendar"
              aria-current={view === "upcoming" ? "page" : undefined}
            >
              Next 90 days
            </Link>
            <Link
              className={`btn btn-sm${view === "all" ? " btn-primary" : ""}`}
              href="/books/tax/calendar?view=all"
              aria-current={view === "all" ? "page" : undefined}
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
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="data">
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
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.occurrenceKey}
                  style={r.greyedOut ? { opacity: 0.55 } : undefined}
                  className={r.greyedOut ? "faint" : undefined}
                >
                  <td>
                    <b>{r.form}</b>
                  </td>
                  <td>
                    <div>{r.description}</div>
                    {r.appliesNote ? <div className="faint small">{r.appliesNote}</div> : null}
                  </td>
                  <td>{r.periodLabel}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <div>{r.dueDisplay}</div>
                    {r.fileByHint ? <div className="faint small">{r.fileByHint}</div> : null}
                  </td>
                  <td>
                    <Chip tone={STATUS_TONE[r.status] ?? "grey"}>{r.statusLabel}</Chip>
                  </td>
                  <td>
                    <Chip tone={APPLIES_TONE[r.applies] ?? "grey"}>{r.appliesLabel}</Chip>
                  </td>
                  <td>
                    {r.worksheetLink ? (
                      <Link href={r.worksheetLink}>Open worksheet</Link>
                    ) : (
                      <span className="faint">—</span>
                    )}
                  </td>
                  <td>
                    <TaxCalendarMarkDoneForm
                      occurrenceKey={r.occurrenceKey}
                      dueYmd={r.dueYmd}
                      defaultDoneDate={doneDefault}
                      markedDone={r.markedDone}
                      doneDateYmd={r.doneDateYmd}
                      doneNote={r.doneNote}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
