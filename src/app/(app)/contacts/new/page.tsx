import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { getSettingsSnapshot } from "@/lib/settings";
import { ownerName, type ContactOwner } from "@/lib/services/contacts";
import { PageHeader } from "@/components/ui";
import { ContactForm } from "../ContactForm";
import { addContactAction } from "../actions";

export default async function NewContactPage({ searchParams }: { searchParams: Promise<{ customer?: string; supplier?: string }> }) {
  await requirePagePermission("edit_data");
  const s = await searchParams;
  const owner: ContactOwner | null = s.customer ? { kind: "customer", id: s.customer } : s.supplier ? { kind: "supplier", id: s.supplier } : null;
  if (!owner) notFound();
  const name = await ownerName(owner);
  if (!name) notFound();
  const { settings } = await getSettingsSnapshot();
  const hasMain = await db.contact.count({
    where: { ...(owner.kind === "customer" ? { customerId: owner.id } : { supplierId: owner.id }), active: true, isMain: true },
  });
  const back = `/${owner.kind === "customer" ? "customers" : "suppliers"}/${owner.id}?tab=contacts`;
  return (
    <>
      <PageHeader
        title="Add contact"
        subtitle={
          <>
            For <Link href={back} style={{ textDecoration: "underline" }}>{name}</Link>. Name and an email or phone are required.
          </>
        }
      />
      <div className="card" style={{ maxWidth: 760 }}>
        <ContactForm contact={null} roles={settings.lists.contactRoles} action={addContactAction.bind(null, owner)} canEdit firstContact={hasMain === 0} />
      </div>
    </>
  );
}
