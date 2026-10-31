import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { getCustomer } from "@/lib/services/companies";
import { getSettingsSnapshot } from "@/lib/settings";
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
import { customerArSnapshot, listBillings, listCollections } from "@/lib/billing/views";
import { ApplyCreditForm } from "@/components/billing/ApplyCreditForm";
import { OverdueBadge } from "@/components/billing/BillingParts";
import { PlusIcon } from "@/components/Icons";
import { resolveCompanyTab } from "@/lib/company-tabs";
import { listWithholdingRates, toSnapshot } from "@/lib/services/withholding";
import { allowGovVatOption, WITHHOLDING_DEFAULT_CODES } from "@/lib/quotes/withholding-defaults";
import { CustomerForm } from "../CustomerForm";
import { saveCustomerAction, setCustomerActiveAction } from "../actions";

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
  const tab = resolveCompanyTab(search.tab);
  const customer = await getCustomer(id);
  if (!customer) notFound();
  const { settings } = await getSettingsSnapshot();
  const canEdit = can(user, "edit_data");
  const whRates = (await listWithholdingRates(undefined, { activeOnly: true })).map(toSnapshot);
  const rates = allowGovVatOption()
    ? whRates
    : whRates.filter((r) => r.code !== WITHHOLDING_DEFAULT_CODES.GOV_VAT_5);
  const { contacts, ...record } = customer;
  const main = contacts.find((c) => c.isMain && c.active);
  const owner = { kind: "customer", id } as const;
  const warnDays = await expiryWarningDays();
  const [addresses, docCounts, docStats, ar] = await Promise.all([
    listAddresses(owner, { includeArchived: true }),
    documentExpiryCounts(owner, warnDays),
    openDocumentStats(owner, user),
    customerArSnapshot(id),
  ]);
  const docIds = (await db.businessDocument.findMany({ where: { customerId: id }, select: { id: true } })).map((d) => d.id);
  const overdueLabel = ar.anyOverdue ? `Overdue ${formatPeso(ar.overdue)}` : null;

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
            {ar.anyOverdue && <OverdueBadge label="Overdue" />}
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
            key: "addresses",
            label: "Addresses",
            count: addresses.filter((a) => !a.archivedAt).length,
            dot: addresses.some((a) => !a.archivedAt && a.needsReview) ? "amber" : undefined,
            href: `/customers/${id}?tab=addresses`,
          },
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
          ar={{ ...ar, overdueLabel }}
        />
      )}

      {tab === "details" && (
        <div className="card">
          <CustomerForm
            customer={record}
            terms={settings.lists.paymentTerms}
            rates={rates}
            action={saveCustomerAction.bind(null, id)}
            canEdit={canEdit}
          />
        </div>
      )}

      {tab === "addresses" && (
        <AddressCards addresses={addresses} ownerKind="customer" ownerId={id} canEdit={canEdit} />
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

      {tab === "balances" && <CustomerBalances customerId={id} canManage={can(user, "manage_billing")} />}
    </>
  );
}

async function CustomerBalances({ customerId, canManage }: { customerId: string; canManage: boolean }) {
  const [ar, billings, collections] = await Promise.all([
    customerArSnapshot(customerId),
    listBillings({ customerId }),
    listCollections({ customerId }),
  ]);
  const openForCredit = billings
    .filter((b) => b.status !== "VOID" && Number(b.balance) > 0)
    .map((b) => ({
      id: b.id,
      label: `Booklet #${b.invoiceNo} (${b.number})`,
      balance: b.balance,
    }));
  return (
    <div className="details-stack">
      <div className="card">
        <div className="card-head">
          <h2>Balances</h2>
          <div className="right">
            <Link className="btn-link small" href={`/print/statements/${customerId}`}>
              Print statement →
            </Link>
          </div>
        </div>
        <dl className="kv kv-grid">
          <dt>Balance due</dt>
          <dd className="num strong">{formatPeso(ar.balanceDue)}</dd>
          <dt>Overdue</dt>
          <dd className="num">
            {formatPeso(ar.overdue)} {ar.anyOverdue && <OverdueBadge label="Overdue" />}
          </dd>
          <dt>Customer credit</dt>
          <dd className="num">{formatPeso(ar.credit)}</dd>
        </dl>
        {canManage && (
          <div className="form-actions" style={{ marginTop: 12 }}>
            <Link className="btn btn-secondary" href={`/billing/billings/new`}>
              Record billing
            </Link>
            <Link className="btn" href={`/billing/collections/new?customerId=${customerId}`}>
              Record collection
            </Link>
          </div>
        )}
        {canManage && (
          <ApplyCreditForm customerId={customerId} availableCredit={ar.credit} billings={openForCredit} />
        )}
      </div>
      <div className="card">
        <h2>Open billings</h2>
        {billings.filter((b) => b.status !== "VOID" && Number(b.balance) > 0).length === 0 ? (
          <EmptyState line="No open billing balances." />
        ) : (
          <ul className="plain-list">
            {billings
              .filter((b) => b.status !== "VOID" && Number(b.balance) > 0)
              .map((b) => (
                <li key={b.id}>
                  <Link href={`/billing/billings/${b.id}`}>Booklet #{b.invoiceNo}</Link> · {formatPeso(b.balance)} balance{" "}
                  <OverdueBadge label={b.overdue.label} />
                </li>
              ))}
          </ul>
        )}
      </div>
      <div className="card">
        <h2>Recent collections</h2>
        {collections.length === 0 ? (
          <EmptyState line="No collections yet." />
        ) : (
          <ul className="plain-list">
            {collections.slice(0, 10).map((c) => (
              <li key={c.id}>
                <Link href={`/billing/collections/${c.id}`}>{c.number}</Link> · {formatPeso(c.amountReceived)}
                {Number(c.unappliedCredit) > 0 ? ` · credit ${formatPeso(c.unappliedCredit)}` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
