import Link from "next/link";
import type { Address, Contact, Customer, WithholdingType } from "@prisma/client";
import { formatDateTime, formatPeso, initials } from "@/lib/format";
import { WITHHOLDING_LABELS } from "@/lib/validation/companies";
import { customerWithholdingChipLabel, parseWithholdingPick } from "@/lib/quotes/withholding-defaults";
import { listWithholdingRates, toSnapshot } from "@/lib/services/withholding";
import type { AgingAmounts } from "@/lib/billing/aging";
import { Avatar, Chip, type ChipTone } from "./ui";
import { Activity } from "./Activity";
import { OverdueBadge } from "./billing/BillingParts";
import { DocumentsCard, OpenDocsCards, type DocCounts, type OpenDocStats } from "./OverviewCards";
import { formatAddress } from "@/lib/addresses/format";
import { PlusIcon } from "./Icons";

const TONE: Record<WithholdingType, ChipTone> = {
  GOVERNMENT: "green",
  TOP_WITHHOLDING_AGENT: "amber",
  NONE: "grey",
};

function pickTone(pick: string[] | null): ChipTone {
  if (pick == null) return "grey";
  if (pick.length === 0) return "grey";
  return "amber";
}

export async function CustomerOverview({
  customer,
  contacts,
  canEdit,
  lastActivityDate,
  addresses,
  docIds,
  docCounts,
  docStats,
  warnDays,
  ar,
}: {
  customer: Customer;
  contacts: Contact[];
  canEdit?: boolean;
  lastActivityDate?: Date | null;
  addresses: Address[];
  docIds: string[];
  docCounts: DocCounts;
  docStats: OpenDocStats;
  warnDays: number;
  ar?: { aging: AgingAmounts; overdue: string; credit: string; anyOverdue: boolean; balanceDue: string; overdueLabel?: string | null };
}) {
  const basePath = `/customers/${customer.id}`;
  const activeAddresses = addresses.filter((a) => !a.archivedAt);
  const mainAddress =
    activeAddresses.find((a) => a.isDefault && a.kind === "BILLING") ?? activeAddresses.find((a) => a.isDefault && a.kind === "OFFICE") ?? activeAddresses[0];
  const activeContacts = contacts.filter((c) => c.active);
  const mainContact = contacts.find((c) => c.isMain && c.active) ?? activeContacts[0];
  const pick = parseWithholdingPick(customer.defaultWithholding);
  const rates = (await listWithholdingRates(undefined, { activeOnly: false })).map(toSnapshot);
  const pickSnaps = pick == null ? null : rates.filter((r) => pick.includes(r.code));
  const pickLabel = customerWithholdingChipLabel(pickSnaps);

  return (
    <div className="overview-dashboard">
      {/* 1. Header Profile Card */}
      <div className="card overview-profile-card">
        <div className="overview-profile-header">
          <div className="overview-avatar" aria-hidden>
            {initials(customer.name)}
          </div>
          <div className="overview-identity">
            <div className="overview-name-row">
              <h2 className="overview-title">{customer.name}</h2>
              {/* Saved pick is the withholding signal — never show type "No withholding" while rates are picked. */}
              <Chip tone={pickTone(pick)}>{pickLabel}</Chip>
              {!(pick && pick.length > 0 && customer.withholdingType === "NONE") && (
                <Chip tone={TONE[customer.withholdingType]}>
                  {customer.withholdingType === "NONE" ? "Private" : WITHHOLDING_LABELS[customer.withholdingType]}
                </Chip>
              )}
              {!customer.active ? (
                <Chip tone="red">Inactive</Chip>
              ) : (
                <Chip tone="green">Active</Chip>
              )}
              {ar?.anyOverdue && <OverdueBadge label={ar.overdueLabel ?? "Overdue"} />}
            </div>
            <div className="overview-meta-grid">
              <div>
                <div className="meta-label">TIN</div>
                <div className="meta-val num" style={{ textAlign: "left" }}>
                  {customer.tin ?? <span className="faint">—</span>}
                </div>
              </div>
              <div>
                <div className="meta-label">Default terms</div>
                <div className="meta-val">{customer.defaultTerms ?? <span className="faint">—</span>}</div>
              </div>
              <div>
                <div className="meta-label">Address</div>
                <div className="meta-val">
                  {mainAddress ? (
                    <Link href={`${basePath}?tab=addresses`}>{formatAddress(mainAddress)}</Link>
                  ) : (
                    <span className="faint">—</span>
                  )}
                </div>
              </div>
              <div>
                <div className="meta-label">Main contact</div>
                <div className="meta-val">
                  {mainContact ? (
                    <span>
                      <strong>{mainContact.name}</strong>
                      {mainContact.role ? ` · ${mainContact.role}` : ""}
                    </span>
                  ) : (
                    <span className="faint">No contact set</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Stat Cards Grid */}
      <div className="stat-grid">
        <Link className={`card stat stat-link${ar && Number(ar.overdue) > 0 ? " stat-red" : ""}`} href={`${basePath}?tab=balances`}>
          <div className="label">Balance due</div>
          <div className="value num">{formatPeso(ar?.balanceDue ?? 0)}</div>
          <div className="foot">
            {ar && Number(ar.credit) > 0 ? `Credit ${formatPeso(ar.credit)}` : "Gross outstanding"}
          </div>
        </Link>
        <OpenDocsCards stats={docStats} basePath={basePath} showTotals />
        <DocumentsCard counts={docCounts} basePath={basePath} warnDays={warnDays} />
        <div className="card stat">
          <div className="label">Last activity</div>
          <div className="value" style={{ fontSize: 16, marginTop: 10 }}>
            {lastActivityDate ? formatDateTime(lastActivityDate) : "—"}
          </div>
          <div className="foot">Records, quotes and SOs</div>
        </div>
      </div>

      {/* 3. AR aging (gross) & Notes */}
      <div className="overview-split-grid">
        <div className="card">
          <div className="card-head">
            <h2>AR aging (gross)</h2>
            <div className="right">
              <span className="faint small">{formatPeso(ar?.aging.total ?? 0)} total</span>
            </div>
          </div>
          <div className="aging-bar-track" aria-hidden>
            <div className={`aging-bar-fill${!ar || Number(ar.aging.total) === 0 ? " empty" : ""}`} style={ar && Number(ar.aging.total) > 0 ? { width: "100%" } : undefined} />
          </div>
          <div className="aging-buckets-grid">
            {(
              [
                ["current", "green", "Current"],
                ["d1_30", "amber", "1–30 d"],
                ["d31_60", "orange", "31–60 d"],
                ["d61_90", "red", "61–90 d"],
                ["d90_plus", "dark-red", "90+ d"],
              ] as const
            ).map(([key, tone, label]) => (
              <div key={key} className="aging-bucket">
                <div className="aging-dot-label">
                  <span className={`aging-dot ${tone}`} /> {label}
                </div>
                <div className="aging-amt num">{formatPeso(ar?.aging[key] ?? 0)}</div>
              </div>
            ))}
          </div>
          <div className="aging-note faint small">
            {!ar || Number(ar.aging.total) === 0 ? (
              <span>Nothing billed yet.</span>
            ) : Number(ar.overdue) > 0 ? (
              <span>Overdue {formatPeso(ar.overdue)}.</span>
            ) : null}
            <Link href={`/print/statements/${customer.id}`}>Print statement</Link>
          </div>
        </div>

        {/* Contacts Strip */}
        <div className="card">
          <div className="card-head">
            <h2>Contacts ({activeContacts.length})</h2>
            <div className="right">
              <Link className="btn-link small" href={`/customers/${customer.id}?tab=contacts`}>
                View all →
              </Link>
            </div>
          </div>
          {activeContacts.length === 0 ? (
            <div className="empty-strip">
              <span className="faint small">No contacts yet.</span>
              {canEdit && (
                <Link
                  className="btn btn-secondary btn-sm"
                  href={`/contacts/new?customer=${customer.id}`}
                  style={{ marginLeft: 8 }}
                >
                  <PlusIcon size={12} /> Add contact
                </Link>
              )}
            </div>
          ) : (
            <div className="contacts-strip-list">
              {activeContacts.slice(0, 3).map((c) => (
                <div key={c.id} className="contacts-strip-item">
                  <Avatar name={c.name} small />
                  <div className="strip-info">
                    <div className="strip-name">
                      <strong>{c.name}</strong>
                      {c.isMain && <Chip tone="dark">Main</Chip>}
                    </div>
                    <div className="strip-sub faint small">
                      {c.role ? `${c.role} · ` : ""}
                      {c.email || c.phone || "No details"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 4. Recent Activity */}
      <Activity
        targets={[
          { entityType: "Customer", ids: [customer.id] },
          { entityType: "Contact", ids: contacts.map((c) => c.id) },
          { entityType: "Address", ids: addresses.map((a) => a.id) },
          { entityType: "BusinessDocument", ids: docIds },
        ]}
        title="Recent activity"
      />
    </div>
  );
}
