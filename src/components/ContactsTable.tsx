import type { Contact } from "@prisma/client";
import { DataTable } from "./DataTable";
import { Chip, EmptyState, PrimaryCell } from "./ui";

export function ContactsTable({ contacts, emptyLine }: { contacts: Contact[]; emptyLine: string }) {
  if (contacts.length === 0) return <div className="card"><EmptyState title="No contacts yet" line={emptyLine} /></div>;
  return (
    <DataTable
      label="Contacts"
      columns={[
        { key: "name", label: "Name" },
        { key: "role", label: "Role" },
        { key: "phone", label: "Phone" },
        { key: "status", label: "Status" },
      ]}
      rows={contacts.map((c) => ({
        id: c.id,
        href: `/contacts/${c.id}`,
        inactive: !c.active,
        cells: {
          name: <PrimaryCell name={c.name} sub={c.email ?? undefined} />,
          role: c.role ?? <span className="faint">—</span>,
          phone: c.phone ?? <span className="faint">—</span>,
          status: c.isMain ? <Chip tone="dark">Main</Chip> : c.active ? <Chip tone="green">Active</Chip> : <Chip>Inactive</Chip>,
        },
        sort: { name: c.name, role: c.role, phone: c.phone, status: c.isMain ? 0 : c.active ? 1 : 2 },
      }))}
    />
  );
}
