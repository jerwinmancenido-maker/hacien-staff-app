import Link from "next/link";
import type { Address, Contact, Supplier, SupplierTaxType } from "@prisma/client";
import { formatDateTime, formatPeso, initials } from "@/lib/format";
import { missingBankDetails, TAX_TYPE_LABELS } from "@/lib/validation/companies";
import { Avatar, Chip, type ChipTone } from "./ui";
import { Activity } from "./Activity";
import { DocumentsCard, OpenDocsCards, type DocCounts, type OpenDocStats } from "./OverviewCards";
import { formatAddress } from "@/lib/addresses/format";
import { AlertTriangleIcon, PlusIcon } from "./Icons";

const TONE: Record<SupplierTaxType, ChipTone> = {
  VAT: "green",
  NON_VAT: "grey",
  NO_RECEIPT: "amber",
};

export async function SupplierOverview({
  supplier,
  contacts,
  canEdit,
  lastActivityDate,
  addresses,
  docIds,
  docCounts,
  docStats,
  warnDays,
}: {
  supplier: Supplier;
  contacts: Contact[];
  canEdit?: boolean;
  lastActivityDate?: Date | null;
  addresses: Address[];
  docIds: string[];
  docCounts: DocCounts;
  docStats: OpenDocStats;
  warnDays: number;
}) {
  const basePath = `/suppliers/${supplier.id}`;
  const activeAddresses = addresses.filter((a) => !a.archivedAt);
  const mainAddress =
    activeAddresses.find((a) => a.isDefault && a.kind === "BILLING") ?? activeAddresses.find((a) => a.isDefault && a.kind === "OFFICE") ?? activeAddresses[0];
  const activeContacts = contacts.filter((c) => c.active);
  const mainContact = contacts.find((c) => c.isMain && c.active) ?? activeContacts[0];
  const isBankMissing = missingBankDetails(supplier);

  return (
    <div className="overview-dashboard">
      {/* 1. Header Profile Card */}
      <div className="card overview-profile-card">
        <div className="overview-profile-header">
          <div className="overview-avatar" aria-hidden>
            {initials(supplier.name)}
          </div>
          <div className="overview-identity">
            <div className="overview-name-row">
              <h2 className="overview-title">{supplier.name}</h2>
              <Chip tone={TONE[supplier.taxType]}>{TAX_TYPE_LABELS[supplier.taxType]}</Chip>
              {!supplier.active ? (
                <Chip tone="red">Inactive</Chip>
              ) : (
                <Chip tone="green">Active</Chip>
              )}
            </div>
            <div className="overview-meta-grid">
              <div>
                <div className="meta-label">TIN</div>
                <div className="meta-val num" style={{ textAlign: "left" }}>
                  {supplier.tin ?? <span className="faint">—</span>}
                </div>
              </div>
              <div>
                <div className="meta-label">Default terms</div>
                <div className="meta-val">{supplier.defaultTerms ?? <span className="faint">—</span>}</div>
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
                <div className="meta-label">Tax rule note</div>
                <div className="meta-val faint small">
                  {supplier.taxType === "VAT"
                    ? "VAT · gives official receipt / invoice"
                    : supplier.taxType === "NON_VAT"
                    ? "Non-VAT · HACIEN is non-VAT, VAT in price is cost"
                    : "Usually no receipt"}
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

      {/* 2. Bank Details Card / Warning */}
      {isBankMissing ? (
        <div className="alert warn bank-warning-card">
          <div className="bank-warning-head">
            <AlertTriangleIcon size={18} />
            <div className="bank-warning-content">
              <strong>Missing bank details</strong>
              <div className="bank-warning-desc">
                Add bank name, account name, and account number in Details so supplier payments and vouchers can be processed.
              </div>
            </div>
            {canEdit && (
              <Link className="btn btn-secondary btn-sm" href={`/suppliers/${supplier.id}?tab=details`}>
                Edit bank info
              </Link>
            )}
          </div>
        </div>
      ) : (
        <div className="card bank-info-card">
          <div className="card-head">
            <h2>Bank payment details</h2>
            <div className="right">
              <span className="chip green">Ready for payments</span>
            </div>
          </div>
          <div className="bank-details-grid">
            <div>
              <div className="meta-label">Bank</div>
              <div className="meta-val strong">UnionBank</div>
            </div>
            <div>
              <div className="meta-label">Account name</div>
              <div className="meta-val">{supplier.bankAccountName}</div>
            </div>
            <div>
              <div className="meta-label">Account number</div>
              <div className="meta-val num strong" style={{ textAlign: "left" }}>
                {supplier.bankAccountNumber}
              </div>
            </div>
            <div>
              <div className="meta-label">Branch</div>
              <div className="meta-val">{supplier.bankBranch || <span className="faint">—</span>}</div>
            </div>
          </div>
        </div>
      )}

      {/* 3. Stat Cards Grid */}
      <div className="stat-grid">
        <div className="card stat">
          <div className="label">We owe</div>
          <div className="value num">{formatPeso(0)}</div>
          <div className="foot">Unpaid supplier bills</div>
        </div>
        <OpenDocsCards stats={docStats} basePath={basePath} showTotals={false} showQuotesAndSos={false} />
        <DocumentsCard counts={docCounts} basePath={basePath} warnDays={warnDays} />
        <div className="card stat">
          <div className="label">Last activity</div>
          <div className="value" style={{ fontSize: 16, marginTop: 10 }}>
            {lastActivityDate ? formatDateTime(lastActivityDate) : "—"}
          </div>
          <div className="foot">Records and purchase documents</div>
        </div>
      </div>

      {/* 4. Contacts Strip & Activity */}
      <div className="overview-split-grid">
        <div className="card">
          <div className="card-head">
            <h2>Contacts ({activeContacts.length})</h2>
            <div className="right">
              <Link className="btn-link small" href={`/suppliers/${supplier.id}?tab=contacts`}>
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
                  href={`/contacts/new?supplier=${supplier.id}`}
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

      {/* 5. Recent Activity */}
      <Activity
        targets={[
          { entityType: "Supplier", ids: [supplier.id] },
          { entityType: "Contact", ids: contacts.map((c) => c.id) },
          { entityType: "Address", ids: addresses.map((a) => a.id) },
          { entityType: "BusinessDocument", ids: docIds },
        ]}
        title="Recent activity"
      />
    </div>
  );
}
