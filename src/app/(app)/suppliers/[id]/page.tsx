import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { getSupplier } from "@/lib/services/companies";
import { getSettingsSnapshot } from "@/lib/settings";
import { TAX_TYPE_LABELS } from "@/lib/validation/companies";
import { formatDate, formatPeso } from "@/lib/format";
import { db } from "@/lib/db";
import { ConfirmAction } from "@/components/ConfirmAction";
import { ContactCards } from "@/components/ContactCards";
import { SupplierOverview } from "@/components/SupplierOverview";
import { PillTabs } from "@/components/PillTabs";
import { Chip, EmptyState, PageHeader } from "@/components/ui";
import { AddressCards } from "@/components/AddressCards";
import { DocumentsTab } from "@/components/DocumentsTab";
import { TransactionsTab, type TransactionsSearch } from "@/components/TransactionsTab";
import { listAddresses } from "@/lib/services/addresses";
import { documentExpiryCounts, expiryWarningDays } from "@/lib/services/business-documents";
import { openDocumentStats } from "@/lib/services/transactions";
import { isPayablesEnabled } from "@/lib/payables/features";
import { listSupplierPayments, supplierPayableBalance } from "@/lib/payables/views";
import { PaymentMethodLabel, PaymentStatusChip } from "@/components/payables/PayablesParts";
import { PlusIcon } from "@/components/Icons";
import { SupplierForm } from "../SupplierForm";
import { saveSupplierAction, setSupplierActiveAction } from "../actions";

const TABS = ["overview", "details", "contacts", "documents", "transactions", "payments", "balances"] as const;
type Tab = (typeof TABS)[number];

export default async function SupplierPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; archived?: string } & TransactionsSearch>;
}) {
  const user = await requirePagePermission("view");
  const { id } = await params;
  const search = await searchParams;
  // "history" was the old name of the Transactions tab.
  const rawTab = search.tab === "history" ? "transactions" : search.tab;
  const tab: Tab = TABS.includes(rawTab as Tab) ? (rawTab as Tab) : "overview";
  const supplier = await getSupplier(id);
  if (!supplier) notFound();
  const { settings } = await getSettingsSnapshot();
  const canEdit = can(user, "edit_data");
  const { contacts, ...record } = supplier;
  const main = contacts.find((c) => c.isMain && c.active);
  const owner = { kind: "supplier", id } as const;
  const warnDays = await expiryWarningDays();
  const [addresses, docCounts, docStats] = await Promise.all([
    listAddresses(owner, { includeArchived: true }),
    documentExpiryCounts(owner, warnDays),
    openDocumentStats(owner, user),
  ]);
  const docIds = (await db.businessDocument.findMany({ where: { supplierId: id }, select: { id: true } })).map((d) => d.id);
  const payablesOn = await isPayablesEnabled();
  const payableBalance = payablesOn ? await supplierPayableBalance(id) : "0.00";
  const supplierPayments = payablesOn && (tab === "payments" || tab === "balances") ? await listSupplierPayments({ supplierId: id }) : [];

  // Fetch latest audit activity timestamp for overview stat card
  const lastActivity = await db.auditLog.findFirst({
    where: {
      OR: [
        { entityType: "Supplier", entityId: id },
        { entityType: "Contact", entityId: { in: contacts.map((c) => c.id) } },
        { entityType: "Address", entityId: { in: addresses.map((a) => a.id) } },
        { entityType: "BusinessDocument", entityId: { in: docIds } },
      ],
    },
    orderBy: { at: "desc" },
    select: { at: true },
  });
  // Latest of the audit log and the last quote / SO change.
  const lastActivityAt =
    [lastActivity?.at, docStats?.lastDocAt].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

  return (
    <>
      <PageHeader
        title={
          <>
            {supplier.name}
            <Chip
              tone={
                supplier.taxType === "VAT"
                  ? "green"
                  : supplier.taxType === "NO_RECEIPT"
                  ? "amber"
                  : "grey"
              }
            >
              {TAX_TYPE_LABELS[supplier.taxType]}
            </Chip>
            {!supplier.active && <Chip tone="red">Inactive</Chip>}
          </>
        }
        subtitle={
          [
            supplier.tin ? `TIN: ${supplier.tin}` : null,
            main ? `Main contact: ${main.name}` : null,
          ]
            .filter(Boolean)
            .join(" · ") || "Supplier record"
        }
        actions={
          canEdit && (
            <>
              {supplier.active ? (
                <ConfirmAction
                  action={setSupplierActiveAction.bind(null, id, false)}
                  label="Mark inactive"
                  title="Mark inactive?"
                  body="It can't be used on new documents. History stays."
                  danger
                />
              ) : (
                <ConfirmAction
                  action={setSupplierActiveAction.bind(null, id, true)}
                  label="Mark active"
                  title="Mark active?"
                  body="It can be used on new documents again."
                />
              )}
              <Link className="btn" href={`/contacts/new?supplier=${id}`}>
                <PlusIcon /> Add contact
              </Link>
            </>
          )
        }
      />

      <PillTabs
        active={tab}
        tabs={[
          { key: "overview", label: "Overview", href: `/suppliers/${id}` },
          { key: "details", label: "Details", href: `/suppliers/${id}?tab=details` },
          {
            key: "contacts",
            label: "Contacts",
            count: contacts.filter((c) => c.active).length,
            href: `/suppliers/${id}?tab=contacts`,
          },
          {
            key: "documents",
            label: "Documents",
            count: docCounts.active,
            dot: docCounts.expired ? "red" : docCounts.expiring ? "amber" : undefined,
            href: `/suppliers/${id}?tab=documents`,
          },
          { key: "transactions", label: "Transactions", href: `/suppliers/${id}?tab=transactions` },
          ...(payablesOn
            ? [{ key: "payments", label: "Payments", count: supplierPayments.length || undefined, href: `/suppliers/${id}?tab=payments` }]
            : []),
          { key: "balances", label: "Balances", href: `/suppliers/${id}?tab=balances` },
        ]}
      />

      {tab === "overview" && (
        <SupplierOverview
          supplier={supplier}
          contacts={contacts}
          canEdit={canEdit}
          lastActivityDate={lastActivityAt}
          addresses={addresses}
          docIds={docIds}
          docCounts={docCounts}
          docStats={docStats}
          warnDays={warnDays}
        />
      )}

      {tab === "details" && (
        <div className="details-stack">
          <div className="card">
            <SupplierForm
              supplier={record}
              terms={settings.lists.paymentTerms}
              action={saveSupplierAction.bind(null, id)}
              canEdit={canEdit}
            />
          </div>
          <AddressCards addresses={addresses} ownerKind="supplier" ownerId={id} canEdit={canEdit} />
        </div>
      )}

      {tab === "contacts" && (
        <ContactCards
          contacts={contacts}
          ownerKind="supplier"
          ownerId={id}
          canEdit={canEdit}
          emptyLine="Add a contact so we know who to call."
        />
      )}

      {tab === "documents" && (
        <DocumentsTab owner={owner} canEdit={canEdit} showArchived={search.archived === "1"} warnDays={warnDays} />
      )}

      {tab === "transactions" && <TransactionsTab owner={owner} user={user} contacts={contacts} search={search} />}

      {tab === "payments" && payablesOn && (
        <div className="card">
          <div className="card-head">
            <h2>Supplier payments</h2>
            {can(user, "manage_payables") && (
              <Link className="btn" href={`/payables/payments/new?supplierId=${id}`}>
                <PlusIcon /> Record payment
              </Link>
            )}
          </div>
          {supplierPayments.length === 0 ? (
            <div className="empty" style={{ padding: "8px 0" }}>
              <EmptyState
                title="No payments yet"
                line={
                  can(user, "manage_payables")
                    ? "When you pay this supplier at the bank, record it here."
                    : "Payments recorded for this supplier will show here."
                }
              />
              {can(user, "manage_payables") && (
                <p style={{ marginTop: 12 }}>
                  <Link className="btn" href={`/payables/payments/new?supplierId=${id}`}>
                    Record payment
                  </Link>
                </p>
              )}
            </div>
          ) : (
            <div className="table-wrap">
              <table className="list">
                <thead>
                  <tr>
                    <th>Number</th>
                    <th>Date</th>
                    <th>Method</th>
                    <th className="num">Paid</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {supplierPayments.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <Link href={`/payables/payments/${p.id}`}>{p.number}</Link>
                      </td>
                      <td>{formatDate(new Date(`${p.date}T00:00:00.000Z`))}</td>
                      <td>
                        <PaymentMethodLabel method={p.method} />
                      </td>
                      <td className="num">{formatPeso(p.amountPaid)}</td>
                      <td>
                        <PaymentStatusChip status={p.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "balances" && (
        <div className="card">
          <dl className="kv">
            <dt>We owe</dt>
            <dd className="num strong" style={{ textAlign: "left" }}>
              {formatPeso(payableBalance)}
            </dd>
          </dl>
          {!payablesOn ? (
            <EmptyState line="Turn on Payables in Settings → Features to track unpaid supplier bills." />
          ) : Number(payableBalance) === 0 ? (
            <EmptyState line="Nothing outstanding for this supplier." />
          ) : (
            <p className="faint small">
              <Link href={`/payables/aging`}>View AP aging →</Link>
            </p>
          )}
        </div>
      )}
    </>
  );
}
