import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { getSettingsSnapshot } from "@/lib/settings";
import { CANT_DEACTIVATE_MAIN } from "@/lib/contacts";
import { Activity } from "@/components/Activity";
import { ConfirmAction } from "@/components/ConfirmAction";
import { Chip, PageHeader } from "@/components/ui";
import { ContactForm } from "../ContactForm";
import { makeMainAction, setContactActiveAction, updateContactAction } from "../actions";

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("view");
  const { id } = await params;
  const contact = await db.contact.findUnique({
    where: { id },
    include: { customer: { select: { id: true, name: true } }, supplier: { select: { id: true, name: true } } },
  });
  if (!contact) notFound();
  const { settings } = await getSettingsSnapshot();
  const canEdit = can(user, "edit_data");
  const { customer, supplier, ...record } = contact;
  const owner = customer ?? supplier!;
  const back = `/${customer ? "customers" : "suppliers"}/${owner.id}?tab=contacts`;

  return (
    <>
      <PageHeader
        title={
          <>
            {contact.name}
            {contact.isMain && <Chip tone="dark">Main</Chip>}
            {!contact.active && <Chip>Inactive</Chip>}
          </>
        }
        subtitle={
          <>
            Contact at <Link href={back} style={{ textDecoration: "underline" }}>{owner.name}</Link>
            {contact.role ? ` · ${contact.role}` : ""}
          </>
        }
        actions={
          canEdit && (
            <>
              {contact.active && !contact.isMain && (
                <ConfirmAction action={makeMainAction.bind(null, id)} label="Make main" title="Make main?" body="This becomes the default contact. The old main stays as a normal contact." />
              )}
              {contact.active ? (
                contact.isMain ? (
                  <button className="btn btn-danger" type="button" disabled title={CANT_DEACTIVATE_MAIN}>
                    Mark inactive
                  </button>
                ) : (
                  <ConfirmAction
                    action={setContactActiveAction.bind(null, id, false)}
                    label="Mark inactive"
                    title="Mark inactive?"
                    body="It's hidden from pickers but stays on old documents."
                    danger
                  />
                )
              ) : (
                <ConfirmAction action={setContactActiveAction.bind(null, id, true)} label="Mark active" title="Mark active?" />
              )}
            </>
          )
        }
      />
      {contact.isMain && contact.active && canEdit && <div className="alert warn">{CANT_DEACTIVATE_MAIN}</div>}
      {!contact.active && <div className="alert warn">This contact is inactive. Mark it active to edit it.</div>}
      <div className="detail-grid">
        <div className="card">
          <ContactForm contact={record} roles={settings.lists.contactRoles} action={updateContactAction.bind(null, id)} canEdit={canEdit} />
        </div>
        <Activity targets={[{ entityType: "Contact", ids: [id] }]} />
      </div>
    </>
  );
}
