import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { getCustomer } from "@/lib/services/companies";
import { getSettingsSnapshot } from "@/lib/settings";
import { WITHHOLDING_LABELS } from "@/lib/validation/companies";
import { formatPeso } from "@/lib/format";
import { Activity } from "@/components/Activity";
import { ConfirmAction } from "@/components/ConfirmAction";
import { ContactsTable } from "@/components/ContactsTable";
import { Chip, EmptyState, PageHeader, Tabs } from "@/components/ui";
import { PlusIcon } from "@/components/Icons";
import { CustomerForm } from "../CustomerForm";
import { saveCustomerAction, setCustomerActiveAction } from "../actions";

const TABS = ["details", "contacts", "history", "balances"] as const;
type Tab = (typeof TABS)[number];

export default async function CustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await requirePagePermission("view");
  const { id } = await params;
  const { tab: rawTab } = await searchParams;
  const tab: Tab = TABS.includes(rawTab as Tab) ? (rawTab as Tab) : "details";
  const customer = await getCustomer(id);
  if (!customer) notFound();
  const { settings } = await getSettingsSnapshot();
  const canEdit = can(user, "edit_data");
  const { contacts, ...record } = customer;
  const main = contacts.find((c) => c.isMain && c.active);

  return (
    <>
      <PageHeader
        title={
          <>
            {customer.name}
            <Chip tone={customer.withholdingType === "GOVERNMENT" ? "green" : customer.withholdingType === "NONE" ? "grey" : "amber"}>
              {WITHHOLDING_LABELS[customer.withholdingType]}
            </Chip>
            {!customer.active && <Chip tone="red">Inactive</Chip>}
          </>
        }
        subtitle={[customer.tin, main ? `Main contact: ${main.name}` : null].filter(Boolean).join(" · ") || "Customer"}
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
                <ConfirmAction action={setCustomerActiveAction.bind(null, id, true)} label="Mark active" title="Mark active?" body="It can be used on new documents again." />
              )}
              <Link className="btn" href={`/contacts/new?customer=${id}`}>
                <PlusIcon /> Add contact
              </Link>
            </>
          )
        }
      />
      <Tabs
        active={tab}
        tabs={[
          { key: "details", label: "Details", href: `/customers/${id}` },
          { key: "contacts", label: `Contacts (${contacts.filter((c) => c.active).length})`, href: `/customers/${id}?tab=contacts` },
          { key: "history", label: "History", href: `/customers/${id}?tab=history` },
          { key: "balances", label: "Balances", href: `/customers/${id}?tab=balances` },
        ]}
      />
      <div className="detail-grid">
        <div>
          {tab === "details" && (
            <div className="card">
              <CustomerForm
                customer={record}
                terms={settings.lists.paymentTerms}
                action={saveCustomerAction.bind(null, id)}
                canEdit={canEdit}
              />
            </div>
          )}
          {tab === "contacts" && <ContactsTable contacts={contacts} emptyLine="Add a contact so we know who to talk to." />}
          {tab === "history" && (
            <div className="card">
              <EmptyState line="Quotes, sales orders and bills for this customer will show here." />
            </div>
          )}
          {tab === "balances" && (
            <div className="card">
              <dl className="kv">
                <dt>Balance due</dt>
                <dd className="num strong" style={{ textAlign: "left" }}>{formatPeso(0)}</dd>
              </dl>
              <EmptyState line="Open bills and collections will show here once billing is built." />
            </div>
          )}
        </div>
        <Activity targets={[{ entityType: "Customer", ids: [id] }, { entityType: "Contact", ids: contacts.map((c) => c.id) }]} />
      </div>
    </>
  );
}
