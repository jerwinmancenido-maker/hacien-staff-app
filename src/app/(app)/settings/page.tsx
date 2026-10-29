import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { roleLabel } from "@/lib/permissions";
import { getSettingsSnapshot } from "@/lib/settings";
import { changedLeaves, NUMBERED_DOCS } from "@/lib/settings/form";
import { formatDocNumber } from "@/lib/settings/numbering";
import { SETTINGS_LABELS, isSettingsKey } from "@/lib/settings/schema";
import { formatDate, formatDateTime, formatPeso } from "@/lib/format";
import { DataTable } from "@/components/DataTable";
import { Chip, EmptyState, PageHeader, PrimaryCell, Tabs } from "@/components/ui";
import { PlusIcon } from "@/components/Icons";
import { SettingsForm } from "./SettingsForm";
import { saveSettingsAction } from "./actions";

const TABS = [
  { key: "users", label: "Users" },
  { key: "approval", label: "Approval rules" },
  { key: "numbering", label: "Numbering" },
  { key: "tax", label: "Tax year" },
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

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
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
      <Tabs active={tab} tabs={TABS.map((t) => ({ key: t.key, label: t.label, href: `/settings?tab=${t.key}` }))} />
      <div style={{ maxWidth: 860 }}>
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

        {tab === "changelog" && <ChangeLog />}
      </div>
    </>
  );
}

async function UsersTab() {
  const users = await db.user.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] });
  if (!users.length) return <div className="card"><EmptyState line="No users yet." /></div>;
  return (
    <DataTable
      label="Users"
      columns={[
        { key: "name", label: "Name" },
        { key: "roles", label: "Roles" },
        { key: "costs", label: "Can see costs" },
        { key: "status", label: "Status" },
      ]}
      rows={users.map((u) => ({
        id: u.id,
        href: `/settings/users/${u.id}`,
        inactive: !u.active,
        cells: {
          name: <PrimaryCell name={u.name} sub={u.email} />,
          roles: roleLabel(u),
          costs: u.canSeeCosts ? <Chip tone="dark">Yes</Chip> : <Chip>No</Chip>,
          status: !u.active ? <Chip tone="red">Turned off</Chip> : u.passwordHash ? <Chip tone="green">Active</Chip> : <Chip tone="amber">Invited</Chip>,
        },
        sort: { name: u.name, roles: roleLabel(u), costs: u.canSeeCosts ? 0 : 1, status: u.active ? 0 : 1 },
      }))}
    />
  );
}

async function ChangeLog() {
  const versions = await db.settingsVersion.findMany({
    orderBy: { version: "desc" },
    include: { createdBy: { select: { name: true } } },
    take: 200,
  });
  if (!versions.length) return <div className="card"><EmptyState line="No settings changes yet." /></div>;
  return (
    <DataTable
      label="Settings change log"
      columns={[
        { key: "version", label: "Version", numeric: true },
        { key: "when", label: "Effective from" },
        { key: "who", label: "Who" },
        { key: "setting", label: "Setting" },
        { key: "change", label: "Old → new", sortable: false },
      ]}
      rows={versions.map((v) => ({
        id: v.id,
        cells: {
          version: <span className="strong">v{v.version}</span>,
          when: (
            <>
              <div>{formatDate(v.effectiveFrom)}</div>
              <div className="small muted">{formatDateTime(v.effectiveFrom).split(", ").pop()}</div>
            </>
          ),
          who: v.createdBy?.name ?? "Seed",
          setting: v.changedKey && isSettingsKey(v.changedKey) ? SETTINGS_LABELS[v.changedKey] : "Defaults",
          change: v.changedKey ? (
            <div className="diff">
              {changedLeaves(v.before, v.after).map((c) => (
                <div key={c.key}>
                  {c.key}: <span className="old">{show(c.before)}</span> → <span>{show(c.after)}</span>
                </div>
              ))}
            </div>
          ) : (
            <span className="muted small">First version from seed defaults</span>
          ),
        },
        sort: { version: v.version, when: v.effectiveFrom.getTime(), who: v.createdBy?.name ?? "", setting: v.changedKey ?? "" },
      }))}
    />
  );
}
