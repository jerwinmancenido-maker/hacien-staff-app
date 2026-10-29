import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { getSupplier } from "@/lib/services/companies";
import { getSettingsSnapshot } from "@/lib/settings";
import { TAX_TYPE_LABELS } from "@/lib/validation/companies";
import { formatPeso } from "@/lib/format";
import { db } from "@/lib/db";
import { ConfirmAction } from "@/components/ConfirmAction";
import { ContactCards } from "@/components/ContactCards";
import { SupplierOverview } from "@/components/SupplierOverview";
import { PillTabs } from "@/components/PillTabs";
import { Chip, EmptyState, PageHeader } from "@/components/ui";
import { PlusIcon } from "@/components/Icons";
import { SupplierForm } from "../SupplierForm";
import { saveSupplierAction, setSupplierActiveAction } from "../actions";

const TABS = ["overview", "details", "contacts", "history", "balances"] as const;
type Tab = (typeof TABS)[number];

export default async function SupplierPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await requirePagePermission("view");
  const { id } = await params;
  const { tab: rawTab } = await searchParams;
  const tab: Tab = TABS.includes(rawTab as Tab) ? (rawTab as Tab) : "overview";
  const supplier = await getSupplier(id);
  if (!supplier) notFound();
  const { settings } = await getSettingsSnapshot();
  const canEdit = can(user, "edit_data");
  const { contacts, ...record } = supplier;
  const main = contacts.find((c) => c.isMain && c.active);

  // Fetch latest audit activity timestamp for overview stat card
  const lastActivity = await db.auditLog.findFirst({
    where: {
      OR: [
        { entityType: "Supplier", entityId: id },
        ...(contacts.length > 0
          ? [{ entityType: "Contact", entityId: { in: contacts.map((c) => c.id) } }]
          : []),
      ],
    },
    orderBy: { at: "desc" },
    select: { at: true },
  });

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
          { key: "history", label: "History", href: `/suppliers/${id}?tab=history` },
          { key: "balances", label: "Balances", href: `/suppliers/${id}?tab=balances` },
        ]}
      />

      {tab === "overview" && (
        <SupplierOverview
          supplier={supplier}
          contacts={contacts}
          canEdit={canEdit}
          lastActivityDate={lastActivity?.at}
        />
      )}

      {tab === "details" && (
        <div className="card">
          <SupplierForm
            supplier={record}
            terms={settings.lists.paymentTerms}
            action={saveSupplierAction.bind(null, id)}
            canEdit={canEdit}
          />
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

      {tab === "history" && (
        <div className="card">
          <EmptyState line="Supplier POs, receiving and payments will show here." />
        </div>
      )}

      {tab === "balances" && (
        <div className="card">
          <dl className="kv">
            <dt>We owe</dt>
            <dd className="num strong" style={{ textAlign: "left" }}>
              {formatPeso(0)}
            </dd>
          </dl>
          <EmptyState line="Unpaid supplier bills will show here once POs are built." />
        </div>
      )}
    </>
  );
}
