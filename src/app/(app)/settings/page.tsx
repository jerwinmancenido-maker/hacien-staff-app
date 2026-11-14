import Link from "next/link";
import { AccessReviewCard } from "./AccessReviewCard";
import { requirePagePermission } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { roleLabel } from "@/lib/permissions";
import { getSettingsSnapshot } from "@/lib/settings";
import { changedLeaves } from "@/lib/settings/form";
import { listWithholdingRates, WITHHOLDING_SETTINGS_KEY } from "@/lib/services/withholding";
import { fromScaled, toScaled } from "@/lib/quotes/calc";
import { SETTINGS_LABELS, isSettingsKey } from "@/lib/settings/schema";
import { formatDateTime, formatPeso } from "@/lib/format";
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
import { Chip, EmptyState, PageHeader } from "@/components/ui";
import { PlusIcon } from "@/components/Icons";
import { SettingsForm } from "./SettingsForm";
import { TaxCalendarForm } from "./TaxCalendarForm";
import { NumberingForm } from "./NumberingForm";
import { PrintCompanyForm } from "./PrintCompanyForm";
import { WithholdingForm } from "./WithholdingForm";
import { saveSettingsAction, savePrintCompanyAction, saveWithholdingAction } from "./actions";
import { AuditLogTab } from "./AuditLogTab";
import { ApiKeysTab, type ApiKeyRow } from "./ApiKeysTab";
import { listApiKeys } from "@/lib/api/keys-admin";
import { apiKeyPepper } from "@/lib/api/keys";
import { API_BOT_EMAIL } from "@/lib/api/bot-user";

// S-85: Settings is a left list of sections. Old ?tab= keys still resolve
// to their section, so bookmarks and links keep working.
const SECTIONS = [
  { key: "company", label: "Company and letterhead", help: "Your company details and the letterhead on every print. Changes apply to new documents only." },
  { key: "documents", label: "Documents and numbering", help: "How document numbers run, and when business documents warn about expiry." },
  { key: "quote-terms", label: "Quote terms", help: "Approval limits, quote validity, and the payment terms offered on quotes." },
  { key: "tax", label: "Tax and BIR", help: "Tax year, BIR calendar, and withholding rates. Check with your accountant when unsure." },
  { key: "booklet", label: "Invoice booklet", help: "Booklet invoice numbers and how collections are recorded." },
  { key: "users", label: "Users and roles", help: "Who can sign in, and what each person may do." },
  { key: "api-keys", label: "API keys", help: "Keys for other software using /api/v1. Every key acts as the API / Bot user; the full key is shown once, at creation." },
  { key: "audit", label: "Audit log", help: "Every change, sign-in and settings save, plus past settings versions. Records are never deleted." },
] as const;
type Section = (typeof SECTIONS)[number]["key"];
const SECTION_BY_TAB: Record<string, Section> = {
  company: "company",
  print: "company",
  features: "company",
  documents: "documents",
  numbering: "documents",
  "quote-terms": "quote-terms",
  approval: "quote-terms",
  lists: "quote-terms",
  tax: "tax",
  "tax-calendar": "tax",
  withholding: "tax",
  booklet: "booklet",
  billing: "booklet",
  users: "users",
  "api-keys": "api-keys",
  audit: "audit",
  changelog: "audit",
};

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string; view?: string; entity?: string; action?: string; user?: string; from?: string; to?: string; page?: string }> }) {
  await requirePagePermission("manage_settings");
  const allParams = await searchParams;
  const { tab: raw } = allParams;
  const section: Section = SECTION_BY_TAB[raw ?? ""] ?? "company";
  const snap = await getSettingsSnapshot();
  const s = snap.settings;
  const save = (key: string) => saveSettingsAction.bind(null, key);

  return (
    <div className="settings-shell">
      <PageHeader
        title="Settings"
        subtitle={`Version ${snap.version} · in effect since ${formatDateTime(snap.effectiveFrom)}. Every save makes a new version; existing documents keep theirs.`}
        actions={
          section === "users" && (
            <Link className="btn" href="/settings/users/new">
              <PlusIcon /> Add user
            </Link>
          )
        }
      />
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map((t) => (
            <Link key={t.key} className={`settings-nav-link${section === t.key ? " active" : ""}`} href={`/settings?tab=${t.key}`}>
              {t.label}
            </Link>
          ))}
        </nav>
        <div className="settings-page">
          <div className="card settings-section-intro">
            <h2 className="settings-section-title">{SECTIONS.find((t) => t.key === section)?.label}</h2>
            <p className="small muted">{SECTIONS.find((t) => t.key === section)?.help}</p>
          </div>
        {section === "users" && <UsersTab />}

        {section === "quote-terms" && (
          <>
            <SettingsForm
              title="Approval rules"
              label={SETTINGS_LABELS.approval}
              versionId={snap.versionId}
              action={save("approval")}
              fields={[
                { name: "marginBelowPct", label: "Needs approval if margin is below", kind: "number", value: s.approval.marginBelowPct, suffix: "%" },
                { name: "totalAbove", label: "Needs approval if total is above", kind: "number", value: s.approval.totalAbove, prefix: "₱", hint: `Now ${formatPeso(s.approval.totalAbove)}` },
                {
                  name: "poTotalAbove",
                  label: "PO needs Approver/Admin if total is above",
                  kind: "number",
                  value: s.approval.poTotalAbove,
                  prefix: "₱",
                  hint: `At ${formatPeso(s.approval.poTotalAbove)} or less: no approval step. Strictly above: Approver/Admin sign-off (Admin may self-approve; Approver may not). Applies to new POs; each PO keeps the limit from when it was created.`,
                },
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

        {section === "documents" && (
          <NumberingForm
            label={SETTINGS_LABELS.numbering}
            versionId={snap.versionId}
            action={save("numbering")}
            numbering={s.numbering}
            taxYear={s.taxYear.year}
          />
        )}

        {section === "tax" && (
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

        {section === "tax" && (
          <TaxCalendarForm
            label={SETTINGS_LABELS.taxCalendar}
            versionId={snap.versionId}
            action={save("taxCalendar")}
            corUploadedAndChecked={s.taxCalendar.corUploadedAndChecked}
            obligations={s.taxCalendar.obligations}
            intro="Owner-only. Turn obligations on or off and edit due days. Dates are provisional until the COR is uploaded and checked. This never files or pays anything. Do not add the abolished 0605 fee."
            corHint={`When off, the calendar shows: “${TAX_CALENDAR_PROVISIONAL_BANNER}”`}
          />
        )}

        {section === "tax" && <WithholdingTab versionId={snap.versionId} />}

        {section === "booklet" && (
          <>
            <SettingsForm
              title="Invoice booklet"
              label={SETTINGS_LABELS.invoiceBooklet}
              versionId={snap.versionId}
              action={save("invoiceBooklet")}
              fields={[
                { group: "Sales Invoice (SI)", name: "salesInvoice.atpNo", label: "ATP no.", kind: "text", value: s.invoiceBooklet.salesInvoice?.atpNo ?? "" },
                { group: "Sales Invoice (SI)", name: "salesInvoice.atpDate", label: "ATP date", kind: "text", value: s.invoiceBooklet.salesInvoice?.atpDate ?? "", hint: "YYYY-MM-DD" },
                { group: "Sales Invoice (SI)", name: "salesInvoice.printer", label: "Printer", kind: "text", value: s.invoiceBooklet.salesInvoice?.printer ?? "", hint: "e.g. CEPRINTS EMPIRE INC." },
                { group: "Sales Invoice (SI)", name: "salesInvoice.seriesFrom", label: "Series from", kind: "number", value: s.invoiceBooklet.salesInvoice?.seriesFrom ?? s.invoiceBooklet.seriesFrom },
                { group: "Sales Invoice (SI)", name: "salesInvoice.seriesTo", label: "Series to", kind: "number", value: s.invoiceBooklet.salesInvoice?.seriesTo ?? s.invoiceBooklet.seriesTo },
                { group: "Sales Invoice (SI)", name: "salesInvoice.bookletCount", label: "Number of booklets", kind: "number", value: s.invoiceBooklet.salesInvoice?.bookletCount ?? 10 },
                { group: "Sales Invoice (SI)", name: "salesInvoice.setsPerBooklet", label: "Sets per booklet", kind: "number", value: s.invoiceBooklet.salesInvoice?.setsPerBooklet ?? 50 },
                { group: "Sales Invoice (SI)", name: "salesInvoice.isNonVat", label: "Marked NON-VAT", kind: "checkbox", value: s.invoiceBooklet.salesInvoice?.isNonVat ?? true },

                { group: "Delivery Receipt (DR)", name: "deliveryReceipt.atpNo", label: "ATP no.", kind: "text", value: s.invoiceBooklet.deliveryReceipt?.atpNo ?? "" },
                { group: "Delivery Receipt (DR)", name: "deliveryReceipt.atpDate", label: "ATP date", kind: "text", value: s.invoiceBooklet.deliveryReceipt?.atpDate ?? "", hint: "YYYY-MM-DD" },
                { group: "Delivery Receipt (DR)", name: "deliveryReceipt.printer", label: "Printer", kind: "text", value: s.invoiceBooklet.deliveryReceipt?.printer ?? "", hint: "e.g. CEPRINTS EMPIRE INC." },
                { group: "Delivery Receipt (DR)", name: "deliveryReceipt.seriesFrom", label: "Series from", kind: "number", value: s.invoiceBooklet.deliveryReceipt?.seriesFrom ?? 1 },
                { group: "Delivery Receipt (DR)", name: "deliveryReceipt.seriesTo", label: "Series to", kind: "number", value: s.invoiceBooklet.deliveryReceipt?.seriesTo ?? 500 },
                { group: "Delivery Receipt (DR)", name: "deliveryReceipt.bookletCount", label: "Number of booklets", kind: "number", value: s.invoiceBooklet.deliveryReceipt?.bookletCount ?? 10 },
                { group: "Delivery Receipt (DR)", name: "deliveryReceipt.setsPerBooklet", label: "Sets per booklet", kind: "number", value: s.invoiceBooklet.deliveryReceipt?.setsPerBooklet ?? 50 },
                { group: "Delivery Receipt (DR)", name: "deliveryReceipt.isNonVat", label: "Marked NON-VAT", kind: "checkbox", value: s.invoiceBooklet.deliveryReceipt?.isNonVat ?? true },

                { group: "Collection Receipt (CR)", name: "collectionReceipt.atpNo", label: "ATP no.", kind: "text", value: s.invoiceBooklet.collectionReceipt?.atpNo ?? "" },
                { group: "Collection Receipt (CR)", name: "collectionReceipt.atpDate", label: "ATP date", kind: "text", value: s.invoiceBooklet.collectionReceipt?.atpDate ?? "", hint: "YYYY-MM-DD" },
                { group: "Collection Receipt (CR)", name: "collectionReceipt.printer", label: "Printer", kind: "text", value: s.invoiceBooklet.collectionReceipt?.printer ?? "", hint: "e.g. CEPRINTS EMPIRE INC." },
                { group: "Collection Receipt (CR)", name: "collectionReceipt.seriesFrom", label: "Series from", kind: "number", value: s.invoiceBooklet.collectionReceipt?.seriesFrom ?? 1 },
                { group: "Collection Receipt (CR)", name: "collectionReceipt.seriesTo", label: "Series to", kind: "number", value: s.invoiceBooklet.collectionReceipt?.seriesTo ?? 500 },
                { group: "Collection Receipt (CR)", name: "collectionReceipt.bookletCount", label: "Number of booklets", kind: "number", value: s.invoiceBooklet.collectionReceipt?.bookletCount ?? 10 },
                { group: "Collection Receipt (CR)", name: "collectionReceipt.setsPerBooklet", label: "Sets per booklet", kind: "number", value: s.invoiceBooklet.collectionReceipt?.setsPerBooklet ?? 50 },
                { group: "Collection Receipt (CR)", name: "collectionReceipt.isNonVat", label: "Marked NON-VAT", kind: "checkbox", value: s.invoiceBooklet.collectionReceipt?.isNonVat ?? true },
              ]}
            />
            <p className="faint small settings-tab-link">
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

        {section === "company" && (
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
                hint: "OFF by default. Leave OFF — HACIEN does not withhold tax from suppliers unless tagged by BIR as a withholding agent. Env override: PAYABLES_2307_ENABLED.",
              },
              {
                name: "itemsImportEnabled",
                label: "Enable CSV import (Item catalog)",
                kind: "checkbox",
                value: s.features.itemsImportEnabled,
                hint: "OFF by default. Turn on to import items from a .csv file on the Items page. Env override: ITEMS_IMPORT_ENABLED.",
              },
              {
                name: "warrantyClaimsEnabled",
                label: "Enable Warranty claims (supplier claims on receiving lines)",
                kind: "checkbox",
                value: s.features.warrantyClaimsEnabled,
                hint: "OFF by default. Turn on to file and track supplier warranty claims from the Receiving pages. Env override: WARRANTY_CLAIMS_ENABLED.",
              },
            ]}
          />
        )}

        {section === "company" && (
          <PrintCompanyForm
            company={s.company}
            print={s.print}
            versionId={snap.versionId}
            action={savePrintCompanyAction}
          />
        )}

        {section === "quote-terms" && (
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

        {section === "documents" && (
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

        {section === "api-keys" && <ApiKeysSection />}

        {section === "audit" && (
          <>
            <AuditLogTab
              search={{
                entity: allParams.entity,
                action: allParams.action,
                user: allParams.user,
                from: allParams.from,
                to: allParams.to,
                page: allParams.page,
              }}
            />
            <ChangeLog />
          </>
        )}
      </div>
    </div>
    </div>
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
  const lastReview = await db.accessReview.findFirst({ orderBy: { reviewedAt: "desc" } });
  if (!users.length) {
    return (
      <div className="card settings-section">
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
      ...(u.email === API_BOT_EMAIL
        ? [{ label: "API bot – can't sign in", tone: "grey" as const }]
        : !u.active
        ? [{ label: "Turned off", tone: "red" as const }]
        : u.passwordHash
        ? [{ label: "Active", tone: "green" as const }]
        : [{ label: "Invited", tone: "blue" as const }]),
    ],
    meta: [
      { label: "Role", value: roleLabel(u) },
      { label: "Email", value: u.email },
      { label: "Costs", value: u.canSeeCosts ? "Yes" : "No" },
    ],
    menuItems: u.email === API_BOT_EMAIL ? [] : [{ label: "Edit user", href: `/settings/users/${u.id}` }],
    sortValues: {
      name: u.name,
      roles: roleLabel(u),
      costs: u.canSeeCosts ? 0 : 1,
      status: u.active ? 0 : 1,
    },
  }));

  return (
    <>
      <AccessReviewCard lastReviewedAt={lastReview?.reviewedAt ?? null} />
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
    </>
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
      <div className="card settings-section">
        <EmptyState line="No settings changes yet." />
      </div>
    );
  }

  return (
    <div className="card settings-section changelog-card">
      <div className="card-head">
        <h2 className="settings-section-title">Settings change log</h2>
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

/** REQ-API-001 PR-B: API keys section (server wrapper — loads keys, checks the pepper). */
async function ApiKeysSection() {
  const rows = await listApiKeys();
  let pepperSet = true;
  try {
    apiKeyPepper();
  } catch {
    pepperSet = false;
  }
  const keys: ApiKeyRow[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    keyPrefix: r.keyPrefix,
    scopes: r.scopes,
    createdByName: r.createdByName,
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
    lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
    status: r.status,
  }));
  return <ApiKeysTab keys={keys} pepperSet={pepperSet} />;
}
