import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { roleLabel } from "@/lib/permissions";
import { getSettingsSnapshot } from "@/lib/settings";
import { changedLeaves, NUMBERED_DOCS } from "@/lib/settings/form";
import { formatDocNumber } from "@/lib/settings/numbering";
import { listWithholdingRates, WITHHOLDING_SETTINGS_KEY } from "@/lib/services/withholding";
import { fromScaled, toScaled } from "@/lib/quotes/calc";
import { SETTINGS_LABELS, isSettingsKey } from "@/lib/settings/schema";
import { formatDateTime, formatPeso } from "@/lib/format";
import { TAX_CALENDAR_OBLIGATIONS } from "@/lib/tax/calendar-obligations";
import {
  BOOKS_OF_ACCOUNTS_TYPE_LABELS,
  INCOME_TAX_METHOD_LABELS,
  TAX_CALENDAR_PROVISIONAL_BANNER,
} from "@/lib/tax/calendar-constants";
import { formatHolidayLines } from "@/lib/tax/holidays";
import {
  incomeTaxMethodForYear,
  incomeTaxMethodSelectYears,
} from "@/lib/tax/income-tax-method";
import { RecordList, type RecordItem } from "@/components/RecordList";
import { PillTabs } from "@/components/PillTabs";
import { Chip, EmptyState, PageHeader } from "@/components/ui";
import { PlusIcon } from "@/components/Icons";
import { SettingsForm } from "./SettingsForm";
import { PrintCompanyForm } from "./PrintCompanyForm";
import { WithholdingForm } from "./WithholdingForm";
import { saveSettingsAction, savePrintCompanyAction, saveWithholdingAction } from "./actions";

const TABS = [
  { key: "users", label: "Users" },
  { key: "approval", label: "Approval rules" },
  { key: "numbering", label: "Numbering" },
  { key: "tax", label: "Tax year" },
  { key: "tax-calendar", label: "Tax calendar" },
  { key: "withholding", label: "Withholding" },
  { key: "billing", label: "Billing" },
  { key: "features", label: "Features" },
  { key: "print", label: "Print & company" },
  { key: "lists", label: "Lists" },
  { key: "changelog", label: "Change log" },
] as const;
type Tab = (typeof TABS)[number]["key"];

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string; view?: string }> }) {
  await requirePagePermission("manage_settings");
  const { tab: raw } = await searchParams;
  const tab: Tab = TABS.some((t) => t.key === raw) ? (raw as Tab) : "users";
  const snap = await getSettingsSnapshot();
  const s = snap.settings;
  const save = (key: string) => saveSettingsAction.bind(null, key);

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle={`Version ${snap.version} · in effect since ${formatDateTime(snap.effectiveFrom)}. Every save makes a new version; existing documents keep theirs.`}
        actions={
          tab === "users" && (
            <Link className="btn" href="/settings/users/new">
              <PlusIcon /> Add user
            </Link>
          )
        }
      />
      <PillTabs
        active={tab}
        tabs={TABS.map((t) => ({ key: t.key, label: t.label, href: `/settings?tab=${t.key}` }))}
      />
      <div style={{ maxWidth: tab === "withholding" ? 1100 : 880 }}>
        {tab === "users" && <UsersTab />}

        {tab === "approval" && (
          <>
            <SettingsForm
              title="Approval rules"
              label={SETTINGS_LABELS.approval}
              versionId={snap.versionId}
              action={save("approval")}
              fields={[
                { name: "marginBelowPct", label: "Needs approval if margin is below", kind: "number", value: s.approval.marginBelowPct, suffix: "%" },
                { name: "totalAbove", label: "Needs approval if total is above", kind: "number", value: s.approval.totalAbove, prefix: "₱", hint: `Now ${formatPeso(s.approval.totalAbove)}` },
              ]}
            />
            <SettingsForm
              title="Quote defaults"
              label={SETTINGS_LABELS.quotes}
              versionId={snap.versionId}
              action={save("quotes")}
              fields={[{ name: "defaultValidityDays", label: "Quotes are valid for", kind: "number", value: s.quotes.defaultValidityDays, suffix: "days" }]}
            />
          </>
        )}

        {tab === "numbering" && (
          <SettingsForm
            title="Numbering"
            label={SETTINGS_LABELS.numbering}
            versionId={snap.versionId}
            action={save("numbering")}
            fields={NUMBERED_DOCS.flatMap((d) => {
              const f = s.numbering[d.key];
              return [
                { name: `${d.key}.prefix`, label: "Prefix", kind: "text" as const, value: f.prefix, group: d.label, hint: `First number: ${formatDocNumber(f, s.taxYear.year, 1)}` },
                { name: `${d.key}.padding`, label: "Counter digits", kind: "number" as const, value: f.padding, group: d.label },
                { name: `${d.key}.resetYearly`, label: "Restart the counter every year", kind: "checkbox" as const, value: f.resetYearly, group: d.label },
              ];
            })}
          />
        )}

        {tab === "tax" && (
          <SettingsForm
            title="Tax year"
            label={SETTINGS_LABELS.taxYear}
            versionId={snap.versionId}
            action={save("taxYear")}
            fields={[
              { name: "year", label: "Tax year", kind: "number", value: s.taxYear.year },
              {
                name: "incomeTaxMethodsByYearPrior",
                label: "method prior",
                kind: "hidden",
                value: JSON.stringify(s.taxYear.incomeTaxMethodsByYear ?? {}),
              },
              {
                name: "methodByYearYears",
                label: "method years",
                kind: "hidden",
                value: incomeTaxMethodSelectYears(
                  s.taxYear.year,
                  s.taxYear.incomeTaxMethodsByYear ?? {},
                ).join(","),
              },
              ...incomeTaxMethodSelectYears(s.taxYear.year, s.taxYear.incomeTaxMethodsByYear ?? {}).map(
                (y) => ({
                  name: `methodByYear.${y}`,
                  label: `Income tax method — ${y}${y === s.taxYear.year ? " (active tax year)" : ""}`,
                  kind: "select" as const,
                  value: incomeTaxMethodForYear(
                    {
                      year: s.taxYear.year,
                      incomeTaxMethod: s.taxYear.incomeTaxMethod,
                      incomeTaxMethodsByYear: s.taxYear.incomeTaxMethodsByYear ?? {},
                    },
                    y,
                  ),
                  options: [
                    { value: "EIGHT_PERCENT", label: INCOME_TAX_METHOD_LABELS.EIGHT_PERCENT },
                    { value: "GRADUATED", label: INCOME_TAX_METHOD_LABELS.GRADUATED },
                  ],
                  hint:
                    y === s.taxYear.year
                      ? "Seed: 2026 = 8%; 2027 onward defaults to Graduated. On 8%, 2551Q is hidden and the annual return is 1701A. On Graduated, 2551Q is quarterly (25 days after quarter end) and annual is 1701 or 1701A."
                      : "Saving another year’s method leaves other years untouched.",
                  group: "Income tax method by year",
                }),
              ),
              {
                name: "booksType",
                label: "Books of accounts type",
                kind: "select",
                value: s.taxYear.booksType ?? "",
                options: [
                  { value: "", label: "Not chosen yet (date to confirm)" },
                  { value: "loose_leaf", label: BOOKS_OF_ACCOUNTS_TYPE_LABELS.loose_leaf },
                  { value: "computerized", label: BOOKS_OF_ACCOUNTS_TYPE_LABELS.computerized },
                ],
                hint: "Loose-leaf due Jan 15; computerized due Jan 30 — both rolled to the next working day when they fall on a weekend or holiday.",
              },
              { name: "nonVatLimit", label: "Non-VAT sales limit", kind: "number", value: s.taxYear.nonVatLimit, prefix: "₱", hint: `Now ${formatPeso(s.taxYear.nonVatLimit)}` },
              { name: "warnFirstPct", label: "First warning at", kind: "number", value: s.taxYear.warnFirstPct, suffix: "% of the limit" },
              { name: "warnSecondPct", label: "Second warning at", kind: "number", value: s.taxYear.warnSecondPct, suffix: "% of the limit" },
              {
                name: "holidays",
                label: "Holiday list (YYYY-MM-DD [regular|special] [name])",
                kind: "lines",
                value: formatHolidayLines(s.taxYear.holidays ?? []),
                hint: "Editable. Seeded with 2026 only — add 2025 / 2027 (and later) yourself; the calendar warns when a year has no holidays. Due dates on a weekend or holiday move to the next working day (RMC 65-2016).",
                full: true,
              },
            ]}
          />
        )}

        {tab === "tax-calendar" && (
          <>
            <p className="faint small" style={{ marginTop: 0 }}>
              Owner-only. Turn obligations on or off and edit due days. Dates are provisional until the COR is
              uploaded and checked. This never files or pays anything. Do not add the abolished 0605 fee.
            </p>
            <SettingsForm
              title="Tax calendar"
              label={SETTINGS_LABELS.taxCalendar}
              versionId={snap.versionId}
              action={save("taxCalendar")}
              showDocumentsOnlyFooter={false}
              fields={[
                {
                  name: "corUploadedAndChecked",
                  label: "COR uploaded and checked",
                  kind: "checkbox" as const,
                  value: s.taxCalendar.corUploadedAndChecked,
                  hint: `When off, the calendar shows: “${TAX_CALENDAR_PROVISIONAL_BANNER}”`,
                  group: "COR",
                },
                ...TAX_CALENDAR_OBLIGATIONS.flatMap((def) => {
                  const o = s.taxCalendar.obligations[def.key];
                  const group = `${def.form} — ${def.description}`;
                  return [
                    {
                      name: `obligations.${def.key}.enabled`,
                      label: `Show ${def.form} on the calendar`,
                      kind: "checkbox" as const,
                      value: o.enabled,
                      hint: def.sourceNote,
                      group,
                    },
                    {
                      name: `obligations.${def.key}.dueDay`,
                      label: "Due day of month",
                      kind: "number" as const,
                      value: o.dueDay ?? "",
                      hint:
                        def.schedule.kind === "undated_year_end"
                          ? "Leave blank for “date to confirm”. Set day (and month below) once RDO confirms."
                          : def.schedule.kind === "quarterly_last_day_after"
                            ? "Leave blank to use the last day of the month after the quarter."
                            : "1–31. Used with the catalog month rule for this form.",
                      group,
                    },
                    {
                      name: `obligations.${def.key}.dueMonth`,
                      label: "Due month (annual / year-end)",
                      kind: "number" as const,
                      value: o.dueMonth ?? "",
                      hint: "1–12. Used for 1701 annual and year-end items; leave blank otherwise.",
                      group,
                    },
                  ];
                }),
              ]}
            />
          </>
        )}

        {tab === "withholding" && <WithholdingTab versionId={snap.versionId} />}

        {tab === "billing" && (
          <>
            <SettingsForm
              title="Invoice booklet"
              label={SETTINGS_LABELS.invoiceBooklet}
              versionId={snap.versionId}
              action={save("invoiceBooklet")}
              fields={[
                {
                  name: "seriesFrom",
                  label: "Series from",
                  kind: "number",
                  value: s.invoiceBooklet.seriesFrom,
                  hint: "Pre-printed booklet start. The app only records these numbers.",
                },
                { name: "seriesTo", label: "Series to", kind: "number", value: s.invoiceBooklet.seriesTo },
                { name: "label", label: "Label", kind: "text", value: s.invoiceBooklet.label ?? "", hint: "e.g. Booklet 1" },
              ]}
            />
            <p className="faint small" style={{ margin: "8px 0 16px" }}>
              <Link href="/billing/booklet">Open booklet usage grid →</Link> Voided invoice numbers are never reused.
            </p>
            <SettingsForm
              title="Collections"
              label={SETTINGS_LABELS.collections}
              versionId={snap.versionId}
              action={save("collections")}
              fields={[
                {
                  name: "overdueGraceDays",
                  label: "Overdue grace days",
                  kind: "number",
                  value: s.collections.overdueGraceDays,
                  hint: "Days after due date before a balance is marked overdue.",
                  suffix: "days",
                },
              ]}
            />
          </>
        )}

        {tab === "features" && (
          <SettingsForm
            title="Features"
            label={SETTINGS_LABELS.features}
            versionId={snap.versionId}
            action={save("features")}
            fields={[
              {
                name: "payablesEnabled",
                label: "Enable Payables (supplier payments)",
                kind: "checkbox",
                value: s.features.payablesEnabled,
                hint: "OFF by default. Ask your admin to turn this on.",
              },
              {
                name: "cashEnabled",
                label: "Enable Cash (accounts, expenses, transfers)",
                kind: "checkbox",
                value: s.features.cashEnabled,
                hint: "OFF by default. Ask your admin to turn this on.",
              },
              {
                name: "booksEnabled",
                label: "Enable Books (read-only registers / export)",
                kind: "checkbox",
                value: s.features.booksEnabled,
                hint: "OFF by default. Ask your admin to turn this on. Draft BIR format — confirm with accountant/RDO.",
              },
              {
                name: "payables2307Enabled",
                label: "Enable Payables 2307 to issue (withholding agent)",
                kind: "checkbox",
                value: s.features.payables2307Enabled,
                hint: "OFF by default. HACIEN is not a withholding agent until RDO confirms. Env override: PAYABLES_2307_ENABLED.",
              },
            ]}
          />
        )}

        {tab === "print" && (
          <PrintCompanyForm
            company={s.company}
            print={s.print}
            versionId={snap.versionId}
            action={savePrintCompanyAction}
          />
        )}

        {tab === "lists" && (
          <SettingsForm
            title="Lists"
            label={SETTINGS_LABELS.lists}
            versionId={snap.versionId}
            action={save("lists")}
            fields={[
              { name: "paymentTerms", label: "Payment terms options", kind: "lines", value: s.lists.paymentTerms, hint: "One per line." },
              { name: "contactRoles", label: "Contact roles", kind: "lines", value: s.lists.contactRoles, hint: "One per line." },
            ]}
          />
        )}

        {tab === "lists" && (
          <SettingsForm
            title="Business documents"
            label={SETTINGS_LABELS.documents}
            versionId={snap.versionId}
            action={save("documents")}
            fields={[
              {
                name: "expiryWarningDays",
                label: "Show \"Expires in N days\" from",
                kind: "number",
                value: s.documents.expiryWarningDays,
                suffix: "days before expiry",
              },
            ]}
          />
        )}

        {tab === "changelog" && <ChangeLog />}
      </div>
    </>
  );
}

async function WithholdingTab({ versionId }: { versionId: string }) {
  const rates = await listWithholdingRates();
  return (
    <WithholdingForm
      versionId={versionId}
      action={saveWithholdingAction}
      rows={rates.map((r) => ({
        id: r.id,
        code: r.code,
        label: r.label,
        lineKind: r.lineKind,
        atcCode: r.atcCode ?? "",
        // 0.0150 → "1.5"
        ratePct: fromScaled(toScaled(Number(r.rate).toFixed(4), 4), 2).replace(/\.?0+$/, ""),
        active: r.active,
        note: r.note ?? "",
      }))}
    />
  );
}

async function UsersTab() {
  const users = await db.user.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] });
  if (!users.length) {
    return (
      <div className="card">
        <EmptyState line="No users yet." />
      </div>
    );
  }

  const items: RecordItem[] = users.map((u) => ({
    id: u.id,
    href: `/settings/users/${u.id}`,
    inactive: !u.active,
    avatarName: u.name,
    title: u.name,
    subtitle: u.email,
    chips: [
      { label: roleLabel(u), tone: "grey" },
      {
        label: u.canSeeCosts ? "Can see costs" : "Cost hidden",
        tone: u.canSeeCosts ? "dark" : "grey",
      },
      ...(!u.active
        ? [{ label: "Turned off", tone: "red" as const }]
        : u.passwordHash
        ? [{ label: "Active", tone: "green" as const }]
        : [{ label: "Invited", tone: "amber" as const }]),
    ],
    meta: [
      { label: "Role", value: roleLabel(u) },
      { label: "Email", value: u.email },
      { label: "Costs", value: u.canSeeCosts ? "Yes" : "No" },
    ],
    menuItems: [{ label: "Edit user", href: `/settings/users/${u.id}` }],
    sortValues: {
      name: u.name,
      roles: roleLabel(u),
      costs: u.canSeeCosts ? 0 : 1,
      status: u.active ? 0 : 1,
    },
  }));

  return (
    <RecordList
      listKey="users"
      label="Users"
      items={items}
      sortColumns={[
        { key: "name", label: "Name" },
        { key: "roles", label: "Role" },
        { key: "costs", label: "Costs" },
        { key: "status", label: "Status" },
      ]}
      defaultSortKey="name"
    />
  );
}

async function ChangeLog() {
  const versions = await db.settingsVersion.findMany({
    orderBy: { version: "desc" },
    include: { createdBy: { select: { name: true } } },
    take: 200,
  });
  if (!versions.length) {
    return (
      <div className="card">
        <EmptyState line="No settings changes yet." />
      </div>
    );
  }

  return (
    <div className="card changelog-card">
      <div className="card-head">
        <h2>Settings change log</h2>
        <div className="right">
          <span className="faint small">{versions.length} versions recorded</span>
        </div>
      </div>
      <div className="activity-timeline changelog-timeline">
        {versions.map((v, i) => (
          <div key={v.id} className="activity-timeline-item">
            <div className="timeline-node">
              <span className="timeline-dot" aria-hidden />
              {i < versions.length - 1 && <span className="timeline-line" aria-hidden />}
            </div>
            <div className="timeline-content">
              <div className="changelog-item-head">
                <span className="chip dark">v{v.version}</span>
                <span className="strong">{v.createdBy?.name ?? "Seed defaults"}</span>
                <span className="faint small">{formatDateTime(v.effectiveFrom)}</span>
                <Chip tone="grey">
                  {v.changedKey === WITHHOLDING_SETTINGS_KEY
                    ? "Withholding rates"
                    : v.changedKey && isSettingsKey(v.changedKey)
                      ? SETTINGS_LABELS[v.changedKey]
                      : "Defaults"}
                </Chip>
              </div>
              <div className="changelog-item-body">
                {v.changedKey ? (
                  <div className="changelog-diff-list">
                    {changedLeaves(v.before, v.after).map((c) => (
                      <div key={c.key} className="changelog-diff-row">
                        <span className="diff-key strong">{c.key}:</span>
                        <span className="diff-old">{show(c.before)}</span>
                        <span className="diff-arrow faint">→</span>
                        <span className="diff-new">{show(c.after)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className="muted small">First version loaded from seed defaults</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
