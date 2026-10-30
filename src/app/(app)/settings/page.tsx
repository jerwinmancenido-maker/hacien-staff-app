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
import { RecordList, type RecordItem } from "@/components/RecordList";
import { PillTabs } from "@/components/PillTabs";
import { Chip, EmptyState, PageHeader } from "@/components/ui";
import { PlusIcon } from "@/components/Icons";
import { SettingsForm } from "./SettingsForm";
import { WithholdingForm } from "./WithholdingForm";
import { saveSettingsAction, saveWithholdingAction } from "./actions";

const TABS = [
  { key: "users", label: "Users" },
  { key: "approval", label: "Approval rules" },
  { key: "numbering", label: "Numbering" },
  { key: "tax", label: "Tax year" },
  { key: "withholding", label: "Withholding" },
  { key: "company", label: "Company" },
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
              { name: "nonVatLimit", label: "Non-VAT sales limit", kind: "number", value: s.taxYear.nonVatLimit, prefix: "₱", hint: `Now ${formatPeso(s.taxYear.nonVatLimit)}` },
              { name: "warnFirstPct", label: "First warning at", kind: "number", value: s.taxYear.warnFirstPct, suffix: "% of the limit" },
              { name: "warnSecondPct", label: "Second warning at", kind: "number", value: s.taxYear.warnSecondPct, suffix: "% of the limit" },
            ]}
          />
        )}

        {tab === "withholding" && <WithholdingTab versionId={snap.versionId} />}

        {tab === "company" && (
          <SettingsForm
            title="Company"
            label={SETTINGS_LABELS.company}
            versionId={snap.versionId}
            action={save("company")}
            fields={[
              { name: "name", label: "Business name", kind: "text", value: s.company.name },
              { name: "tin", label: "TIN", kind: "text", value: s.company.tin, hint: "000-000-000-000" },
              { name: "address", label: "Address", kind: "textarea", value: s.company.address },
            ]}
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
