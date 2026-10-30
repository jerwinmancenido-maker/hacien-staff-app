import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { getCustomer } from "@/lib/services/companies";
import { getSettingsSnapshot } from "@/lib/settings";
import { listWithholdingRates } from "@/lib/services/withholding";
import { WITHHOLDING_LABELS } from "@/lib/validation/companies";
import { formatPeso } from "@/lib/format";
import { db } from "@/lib/db";
import { ConfirmAction } from "@/components/ConfirmAction";
import { ContactCards } from "@/components/ContactCards";
import { CustomerOverview } from "@/components/CustomerOverview";
import { PillTabs } from "@/components/PillTabs";
import { Chip, EmptyState, PageHeader } from "@/components/ui";
import { AddressCards } from "@/components/AddressCards";
import { DocumentsTab } from "@/components/DocumentsTab";
import { TransactionsTab, type TransactionsSearch } from "@/components/TransactionsTab";
import { listAddresses } from "@/lib/services/addresses";
import { documentExpiryCounts, expiryWarningDays } from "@/lib/services/business-documents";
import { openDocumentStats } from "@/lib/services/transactions";
import { PlusIcon } from "@/components/Icons";
import { CustomerForm } from "../CustomerForm";
import { saveCustomerAction, setCustomerActiveAction } from "../actions";

const TABS = ["overview", "details", "contacts", "documents", "transactions", "balances"] as const;
type Tab = (typeof TABS)[number];

export default async function CustomerPage({
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
  const customer = await getCustomer(id);
  if (!customer) notFound();
  const { settings } = await getSettingsSnapshot();
  const rates = (await listWithholdingRates()).map((r) => ({ code: r.code, label: r.label, active: r.active }));
  const canEdit = can(user, "edit_data");
  const { contacts, ...record } = customer;
  const main = contacts.find((c) => c.isMain && c.active);
  const owner = { kind: "customer", id } as const;
  const warnDays = await expiryWarningDays();
  const [addresses, docCounts, docStats] = await Promise.all([
    listAddresses(owner, { includeArchived: true }),
    documentExpiryCounts(owner, warnDays),
    openDocumentStats(owner, user),
  ]);
  const docIds = (await db.businessDocument.findMany({ where: { customerId: id }, select: { id: true } })).map((d) => d.id);

  // Fetch latest audit activity timestamp for overview stat card
  const lastActivity = await db.auditLog.findFirst({
    where: {
      OR: [
        { entityType: "Customer", entityId: id },
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
            {customer.name}
            <Chip
              tone={
                customer.withholdingType === "GOVERNMENT"
                  ? "green"
                  : customer.withholdingType === "NONE"
                  ? "grey"
                  : "amber"
              }
            >
              {WITHHOLDING_LABELS[customer.withholdingType]}
            </Chip>
            {!customer.active ? (
              <Chip tone="red">Inactive</Chip>
            ) : (
              <Chip tone="green">Active</Chip>
            )}
          </>
        }
        subtitle={
          [
            customer.tin ? `TIN: ${customer.tin}` : null,
            main ? `Main contact: ${main.name}` : null,
          ]
            .filter(Boolean)
            .join(" · ") || "Customer record"
        }
        actions={
          canEdit && (
            <>
              {customer.active ? (
                <ConfirmAction
                  action={setCustomerActiveAction.bind(null, id, false)}
                  label="Mark inactive"
                  title="Mark inactive?"
                  body="It can't be used on new documents. History stays."
                  danger
                />
              ) : (
                <ConfirmAction
                  action={setCustomerActiveAction.bind(null, id, true)}
                  label="Mark active"
                  title="Mark active?"
                  body="It can be used on new documents again."
                />
              )}
              <Link className="btn" href={`/contacts/new?customer=${id}`}>
                <PlusIcon /> Add contact
              </Link>
            </>
          )
        }
      />

      <PillTabs
        active={tab}
        tabs={[
          { key: "overview", label: "Overview", href: `/customers/${id}` },
          { key: "details", label: "Details", href: `/customers/${id}?tab=details` },
          {
            key: "contacts",
            label: "Contacts",
            count: contacts.filter((c) => c.active).length,
            href: `/customers/${id}?tab=contacts`,
          },
          {
            key: "documents",
            label: "Documents",
            count: docCounts.active,
            dot: docCounts.expired ? "red" : docCounts.expiring ? "amber" : undefined,
            href: `/customers/${id}?tab=documents`,
          },
          { key: "transactions", label: "Transactions", href: `/customers/${id}?tab=transactions` },
          { key: "balances", label: "Balances", href: `/customers/${id}?tab=balances` },
        ]}
      />

      {tab === "overview" && (
        <CustomerOverview
          customer={customer}
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
            <CustomerForm
              customer={record}
              terms={settings.lists.paymentTerms}
              rates={rates}
              action={saveCustomerAction.bind(null, id)}
              canEdit={canEdit}
            />
          </div>
          <AddressCards addresses={addresses} ownerKind="customer" ownerId={id} canEdit={canEdit} />
        </div>
      )}

      {tab === "contacts" && (
        <ContactCards
          contacts={contacts}
          ownerKind="customer"
          ownerId={id}
          canEdit={canEdit}
          emptyLine="Add a contact so we know who to talk to."
        />
      )}

      {tab === "documents" && (
        <DocumentsTab owner={owner} canEdit={canEdit} showArchived={search.archived === "1"} warnDays={warnDays} />
      )}

      {tab === "transactions" && <TransactionsTab owner={owner} user={user} contacts={contacts} search={search} />}

      {tab === "balances" && (
        <div className="card">
          <dl className="kv">
            <dt>Balance due</dt>
            <dd className="num strong" style={{ textAlign: "left" }}>
              {formatPeso(0)}
            </dd>
          </dl>
          <EmptyState line="Open bills and collections will show here once billing is built." />
        </div>
      )}
    </>
  );
}
