import Link from "next/link";
import { AccessReviewCard } from "./AccessReviewCard";
import { requirePagePermission } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { roleLabel } from "@/lib/permissions";
import { getSettingsSnapshot } from "@/lib/settings";
import { changedLeaves } from "@/lib/settings/form";
import { listWithholdingRates, WITHHOLDING_SETTINGS_KEY } from "@/lib/services/withholding";
import { fromScaled, toScaled } from "@/lib/quotes/calc";
import { ALERT_EVENTS, SETTINGS_LABELS, isSettingsKey } from "@/lib/settings/schema";
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
import { readableDiffValue } from "@/components/DiffView";
import { PlusIcon } from "@/components/Icons";
import { SettingsForm } from "./SettingsForm";
import { TaxCalendarForm } from "./TaxCalendarForm";
import { NumberingForm } from "./NumberingForm";
import { PrintCompanyForm } from "./PrintCompanyForm";
import { WithholdingForm } from "./WithholdingForm";
import { uploadMaxMb } from "@/lib/business-docs/sniff";
import { saveSettingsAction, savePrintCompanyAction, saveWithholdingAction, saveBusinessAction, setBusinessActiveAction } from "./actions";
import { BusinessesForm } from "./BusinessesForm";
import { listBusinesses } from "@/lib/services/businesses";
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
  { key: "businesses", label: "Businesses", help: "Other businesses whose transactions you record in this app. Their orders stay out of this company's sales, Books and tax." },
  { key: "users", label: "Users and roles", help: "Who can sign in, and what each person may do." },
  { key: "api-keys", label: "API keys", help: "Keys for other software using /api/v1. Every key acts as the API / Bot user; the full key is shown once, at creation." },
  { key: "audit", label: "Audit log", help: "Every change, sign-in and settings save, plus past settings versions. Records are never deleted." },
] as const;
type Section = (typeof SECTIONS)[number]["key"];
const SECTION_BY_TAB: Record<string, Section> = {
  company: "company",
  print: "company",
  features: "company",
  alerts: "company",
  identity: "company",
  wording: "company",
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
  businesses: "businesses",
  users: "users",
  "api-keys": "api-keys",
  audit: "audit",
  changelog: "audit",
};

function show(v: unknown): string {
  // readableDiffValue renders arrays/objects in plain words — a raw join
  // printed "[object Object]" for the banks / e-wallets lists.
  return readableDiffValue(v);
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string; view?: string; entity?: string; action?: string; user?: string; from?: string; to?: string; page?: string }> }) {
  await requirePagePermission("manage_settings");
  const allParams = await searchParams;
  const { tab: raw } = allParams;
  const section: Section = SECTION_BY_TAB[raw ?? ""] ?? "company";
  const snap = await getSettingsSnapshot();
  const s = snap.settings;
  const businesses = section === "businesses" ? await listBusinesses() : [];
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
              {
                name: "isVatRegistered",
                label: "Company is VAT-registered",
                kind: "checkbox",
                value: s.taxYear.isVatRegistered,
                hint: "Off today — the company is NON-VAT on the 8% income-tax option. This records the tax posture in one place; check with your accountant before changing it.",
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
                hint: "OFF by default.",
              },
              {
                name: "cashEnabled",
                label: "Enable Cash (accounts, expenses, transfers)",
                kind: "checkbox",
                value: s.features.cashEnabled,
                hint: "OFF by default.",
              },
              {
                name: "booksEnabled",
                label: "Enable Books (read-only registers / export)",
                kind: "checkbox",
                value: s.features.booksEnabled,
                hint: "OFF by default. Draft BIR format — confirm with accountant/RDO.",
              },
              {
                name: "payables2307Enabled",
                label: "Enable Payables 2307 to issue (withholding agent)",
                kind: "checkbox",
                value: s.features.payables2307Enabled,
                hint: `OFF by default. Leave OFF — ${s.identity.appShortName} does not withhold tax from suppliers unless tagged by BIR as a withholding agent.`,
              },
              {
                name: "itemsImportEnabled",
                label: "Enable CSV import (Item catalog)",
                kind: "checkbox",
                value: s.features.itemsImportEnabled,
                hint: "OFF by default. Turn on to import items from a .csv file on the Items page.",
              },
              {
                name: "periodCloseEnabled",
                label: "Enable Period close (Books — lock a month against new postings)",
                kind: "checkbox",
                value: s.features.periodCloseEnabled,
                hint: "OFF by default. Turn on to close and reopen months on the Books page. Closing a month refuses new postings dated in it until an Admin reopens it.",
              },
              {
                name: "warrantyClaimsEnabled",
                label: "Enable Warranty claims (supplier claims on receiving lines)",
                kind: "checkbox",
                value: s.features.warrantyClaimsEnabled,
                hint: "OFF by default. Turn on to file and track supplier warranty claims from the Receiving pages.",
              },
              {
                name: "receivingEmailEnabled",
                label: "Email the team when goods are received",
                kind: "checkbox",
                value: s.features.receivingEmailEnabled,
                hint: "ON by default. Who receives it is set under Email alerts below (default: the PO's creator and every active Admin/Approver). The bell also shows goods received in the last 7 days.",
              },
            ]}
          />
        )}

        {section === "company" && (
          <>
            <p className="faint small settings-tab-link">
              Email alerts are one-way notes about things that just happened — they never approve, pay or
              change anything; approvals stay in the app. Alerts go out by email only: a chat channel would
              need a bot key, which is not set up.
            </p>
            <SettingsForm
              title="Email alerts"
              label={SETTINGS_LABELS.alerts}
              versionId={snap.versionId}
              action={save("alerts")}
              showDocumentsOnlyFooter={false}
              fields={ALERT_EVENTS.flatMap((ev) => {
                const rule = s.alerts[ev.key];
                return [
                  {
                    group: ev.label,
                    name: `${ev.key}.enabled`,
                    label: "Send this alert",
                    kind: "checkbox" as const,
                    value: rule.enabled,
                    hint: ev.help,
                  },
                  { name: `${ev.key}.role.admin`, label: "Admins", kind: "checkbox" as const, value: rule.roles.includes("admin") },
                  { name: `${ev.key}.role.approver`, label: "Approvers", kind: "checkbox" as const, value: rule.roles.includes("approver") },
                  { name: `${ev.key}.role.staff`, label: "Staff", kind: "checkbox" as const, value: rule.roles.includes("staff") },
                  {
                    name: `${ev.key}.emails`,
                    label: "Extra email addresses (one per line)",
                    kind: "lines" as const,
                    value: rule.emails,
                    full: true,
                  },
                ];
              })}
            />
          </>
        )}

        {section === "company" && (
          <PrintCompanyForm
            company={s.company}
            print={s.print}
            versionId={snap.versionId}
            action={savePrintCompanyAction}
            maxMb={uploadMaxMb()}
          />
        )}

        {section === "company" && (
          <SettingsForm
            title="App identity"
            label={SETTINGS_LABELS.identity}
            versionId={snap.versionId}
            action={save("identity")}
            fields={[
              { name: "policiesUrl", label: "Policies page URL", kind: "text", value: s.identity.policiesUrl, hint: "Printed as a QR code and link on quote and sales-order prints.", full: true },
              { name: "policiesDisplayHost", label: "Policies link, shown as text", kind: "text", value: s.identity.policiesDisplayHost },
              { name: "policyVersionLine", label: "Policy version line", kind: "text", value: s.identity.policyVersionLine, hint: "Footer line on customer-facing prints. Bumping a version waits for the retained lawyer's confirmation.", full: true },
              { name: "smsSenderId", label: "SMS sender ID (default)", kind: "text", value: s.identity.smsSenderId, hint: "The UNISMS_SENDER_ID environment setting still overrides this at send time." },
              { name: "csvFilePrefix", label: "CSV export filename prefix", kind: "text", value: s.identity.csvFilePrefix, hint: "Downloads are named <prefix>-<register>-…. Leave blank for no prefix." },
              { name: "appTitle", label: "App title", kind: "text", value: s.identity.appTitle, hint: "Browser tab title, and the installed app's full name." },
              { name: "appShortName", label: "App short name", kind: "text", value: s.identity.appShortName, hint: "The installed app's short name." },
            ]}
          />
        )}

        {section === "company" && (
          <>
            <p className="faint small settings-tab-link">
              Lawyer-governed texts (BIR-WORDING.md): the wording below is the settled legal text printed on
              documents. Changing any of it needs Jerwin&apos;s approval and legal verification first.
            </p>
            <SettingsForm
              title="Print wording (lawyer-governed)"
              label={SETTINGS_LABELS.wording}
              versionId={snap.versionId}
              action={save("wording")}
              fields={[
                { group: "Document wording", name: "nonVatLabel", label: "Registration label on letterheads", kind: "text", value: s.wording.nonVatLabel },
                { group: "Document wording", name: "inputTaxDisclaimer", label: "Input-tax disclaimer (billing & collection)", kind: "textarea", value: s.wording.inputTaxDisclaimer },
                { group: "Document wording", name: "billingDisclaimer", label: "Billing disclaimer (the one disclaimer)", kind: "textarea", value: s.wording.billingDisclaimer },
                { group: "Document wording", name: "packingListDisclaimer", label: "Packing list disclaimer", kind: "textarea", value: s.wording.packingListDisclaimer },
                { group: "Document wording", name: "ewt2307Note", label: "2307 note (supplier payment voucher)", kind: "textarea", value: s.wording.ewt2307Note },
                { group: "Document wording", name: "thankYou", label: "Thank-you line", kind: "text", value: s.wording.thankYou },
                { group: "Document wording", name: "quotationNotInvoice", label: "Quotation footer line", kind: "text", value: s.wording.quotationNotInvoice },
                { group: "Document wording", name: "salesOrderNotInvoice", label: "Sales order footer line", kind: "text", value: s.wording.salesOrderNotInvoice },
                { group: "Terms of Sale — points 1 to 3", name: "termsHeading", label: "Terms heading", kind: "text", value: s.wording.termsHeading },
                { group: "Terms of Sale — points 1 to 3", name: "termsPoint1ValidityDefault", label: "Point 1 — validity sentence (default)", kind: "textarea", value: s.wording.termsPoint1ValidityDefault },
                { group: "Terms of Sale — points 1 to 3", name: "termsPoint1ValidityCustom", label: "Point 1 — validity sentence (custom days; keep {days})", kind: "text", value: s.wording.termsPoint1ValidityCustom },
                { group: "Terms of Sale — points 1 to 3", name: "termsPoint1Body", label: "Point 1 — body", kind: "textarea", value: s.wording.termsPoint1Body },
                { group: "Terms of Sale — points 1 to 3", name: "termsPoint2Upfront", label: "Point 2 — 100% upfront", kind: "textarea", value: s.wording.termsPoint2Upfront },
                { group: "Terms of Sale — points 1 to 3", name: "termsPoint2FiftyFifty", label: "Point 2 — 50% down, 50% on delivery", kind: "textarea", value: s.wording.termsPoint2FiftyFifty },
                { group: "Terms of Sale — points 1 to 3", name: "termsPoint2Net30", label: "Point 2 — Net 30", kind: "textarea", value: s.wording.termsPoint2Net30 },
                { group: "Terms of Sale — points 1 to 3", name: "termsPoint2Cod", label: "Point 2 — COD (Option 1A)", kind: "textarea", value: s.wording.termsPoint2Cod },
                { group: "Terms of Sale — points 1 to 3", name: "termsPaymentAntiFraud", label: "Point 2 — anti-fraud sentence (standard)", kind: "textarea", value: s.wording.termsPaymentAntiFraud },
                { group: "Terms of Sale — points 1 to 3", name: "termsCustomTermsAntiFraud", label: "Point 2 — anti-fraud sentence (custom terms, Option 3A)", kind: "textarea", value: s.wording.termsCustomTermsAntiFraud },
                { group: "Terms of Sale — points 1 to 3", name: "termsPoint3WithLeadTime", label: "Point 3 — with lead time (keep {days})", kind: "textarea", value: s.wording.termsPoint3WithLeadTime },
                { group: "Terms of Sale — points 1 to 3", name: "termsPoint3NoLeadTime", label: "Point 3 — no lead time", kind: "textarea", value: s.wording.termsPoint3NoLeadTime },
                { group: "Terms of Sale — points 4 to 7", name: "termsPoint4", label: "Point 4 — delivery & damage reporting", kind: "textarea", value: s.wording.termsPoint4 },
                { group: "Terms of Sale — points 4 to 7", name: "termsPoint5Goods", label: "Point 5A — warranty (goods)", kind: "textarea", value: s.wording.termsPoint5Goods },
                { group: "Terms of Sale — points 4 to 7", name: "termsPoint5Services", label: "Point 5B — warranty (services only)", kind: "textarea", value: s.wording.termsPoint5Services },
                { group: "Terms of Sale — points 4 to 7", name: "termsPoint6", label: "Point 6 — withholding tax", kind: "textarea", value: s.wording.termsPoint6 },
                { group: "Terms of Sale — points 4 to 7", name: "termsPoint7", label: "Point 7 — ownership, late payment & venue", kind: "textarea", value: s.wording.termsPoint7 },
                { group: "Terms figures", name: "termsLateInterestPctPerYear", label: "Late-payment interest (point 7)", kind: "number", value: s.wording.termsLateInterestPctPerYear, suffix: "% a year" },
                { group: "Terms figures", name: "termsAttorneysFeesPct", label: "Attorney's fees (point 7)", kind: "number", value: s.wording.termsAttorneysFeesPct, suffix: "%" },
              ]}
            />
          </>
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

        {section === "businesses" && (
          <BusinessesForm
            ownCompanyName={s.company.name}
            businesses={businesses}
            saveAction={saveBusinessAction}
            toggleAction={setBusinessActiveAction}
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
        tone: u.canSeeCosts ? "blue" : "grey",
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
