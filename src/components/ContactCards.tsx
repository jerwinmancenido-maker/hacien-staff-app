"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Contact } from "@prisma/client";
import { Avatar, Chip, EmptyState } from "./ui";
import { CheckIcon, CopyIcon, MailIcon, PhoneIcon, PlusIcon } from "./Icons";
import { RowMenu, type RowMenuItem } from "./RowMenu";
import { makeMainAction, setContactActiveAction } from "@/app/(app)/contacts/actions";

export type ContactCardsProps = {
  contacts: Contact[];
  emptyLine?: string;
  ownerKind?: "customer" | "supplier";
  ownerId?: string;
  canEdit?: boolean;
};

export function ContactCards({
  contacts,
  emptyLine = "Add a contact so we know who to talk to.",
  ownerKind,
  ownerId,
  canEdit = true,
}: ContactCardsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showInactive, setShowInactive] = useState(false);

  const activeContacts = contacts.filter((c) => c.active);
  const inactiveContacts = contacts.filter((c) => !c.active);

  function handleMakeMain(id: string) {
    startTransition(async () => {
      await makeMainAction(id);
      router.refresh();
    });
  }

  function handleSetActive(id: string, active: boolean) {
    startTransition(async () => {
      await setContactActiveAction(id, active);
      router.refresh();
    });
  }

  const newContactHref =
    ownerKind && ownerId
      ? `/contacts/new?${ownerKind}=${ownerId}`
      : "/contacts/new";

  return (
    <div className="contact-cards-wrap">
      {contacts.length === 0 ? (
        <div className="card">
          <EmptyState title="No contacts yet" line={emptyLine} />
          {canEdit && (
            <div style={{ textAlign: "center", marginTop: 14 }}>
              <Link className="btn btn-secondary btn-sm" href={newContactHref}>
                <PlusIcon size={14} /> Add first contact
              </Link>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="contact-grid">
            {activeContacts.map((c) => (
              <SingleContactCard
                key={c.id}
                contact={c}
                canEdit={canEdit}
                isPending={isPending}
                onMakeMain={() => handleMakeMain(c.id)}
                onToggleActive={() => handleSetActive(c.id, false)}
              />
            ))}

            {canEdit && (
              <Link href={newContactHref} className="contact-card-add">
                <PlusIcon size={18} />
                <span>Add contact</span>
              </Link>
            )}
          </div>

          {inactiveContacts.length > 0 && (
            <div className="contact-inactive-section">
              <button
                type="button"
                className="contact-inactive-toggle"
                onClick={() => setShowInactive((v) => !v)}
              >
                {showInactive ? "▾ Hide inactive" : "▸ Show inactive"} ({inactiveContacts.length})
              </button>
              {showInactive && (
                <div className="contact-grid" style={{ marginTop: 12 }}>
                  {inactiveContacts.map((c) => (
                    <SingleContactCard
                      key={c.id}
                      contact={c}
                      canEdit={canEdit}
                      isPending={isPending}
                      onMakeMain={() => handleMakeMain(c.id)}
                      onToggleActive={() => handleSetActive(c.id, true)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SingleContactCard({
  contact,
  canEdit,
  isPending,
  onMakeMain,
  onToggleActive,
}: {
  contact: Contact;
  canEdit: boolean;
  isPending: boolean;
  onMakeMain: () => void;
  onToggleActive: () => void;
}) {
  const [copiedField, setCopiedField] = useState<"email" | "phone" | null>(null);

  async function copyText(field: "email" | "phone", text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1500);
    } catch {
      // fallback
    }
  }

  const menuItems: RowMenuItem[] = [];

  menuItems.push({
    label: "Edit contact",
    href: `/contacts/${contact.id}`,
  });

  if (canEdit) {
    if (contact.active && !contact.isMain) {
      menuItems.push({
        label: isPending ? "Updating…" : "Make main contact",
        onClick: onMakeMain,
      });
    }
    if (contact.active) {
      menuItems.push({
        label: isPending ? "Updating…" : "Mark inactive",
        danger: true,
        onClick: onToggleActive,
      });
    } else {
      menuItems.push({
        label: isPending ? "Updating…" : "Mark active",
        onClick: onToggleActive,
      });
    }
  }

  return (
    <div className={`contact-card${!contact.active ? " inactive" : ""}`}>
      <div className="contact-card-top">
        <div className="contact-card-identity">
          <Avatar name={contact.name} />
          <div className="contact-card-who">
            <div className="contact-card-name">
              <span>{contact.name}</span>
              {contact.isMain && <Chip tone="dark">Main</Chip>}
              {!contact.active && <Chip tone="red">Inactive</Chip>}
            </div>
            {contact.role && (
              <div className="contact-card-role">
                <Chip tone="grey">{contact.role}</Chip>
              </div>
            )}
          </div>
        </div>
        <RowMenu items={menuItems} />
      </div>

      <div className="contact-card-channels">
        {contact.email ? (
          <div className="contact-channel-row">
            <MailIcon size={14} />
            <a href={`mailto:${contact.email}`} className="contact-link" title={`Email ${contact.email}`}>
              {contact.email}
            </a>
            <button
              type="button"
              className="copy-btn"
              title="Copy email"
              onClick={() => copyText("email", contact.email!)}
              aria-label="Copy email"
            >
              {copiedField === "email" ? (
                <span className="copied-tag">
                  <CheckIcon size={12} /> Copied
                </span>
              ) : (
                <CopyIcon size={13} />
              )}
            </button>
          </div>
        ) : (
          <div className="contact-channel-row empty-channel">
            <MailIcon size={14} />
            <span className="faint">No email</span>
          </div>
        )}

        {contact.phone ? (
          <div className="contact-channel-row">
            <PhoneIcon size={14} />
            <a href={`tel:${contact.phone}`} className="contact-link" title={`Call ${contact.phone}`}>
              {contact.phone}
            </a>
            <button
              type="button"
              className="copy-btn"
              title="Copy phone"
              onClick={() => copyText("phone", contact.phone!)}
              aria-label="Copy phone"
            >
              {copiedField === "phone" ? (
                <span className="copied-tag">
                  <CheckIcon size={12} /> Copied
                </span>
              ) : (
                <CopyIcon size={13} />
              )}
            </button>
          </div>
        ) : (
          <div className="contact-channel-row empty-channel">
            <PhoneIcon size={14} />
            <span className="faint">No phone</span>
          </div>
        )}
      </div>
    </div>
  );
}
