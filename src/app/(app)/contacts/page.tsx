import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/current-user";
import { listAllContacts } from "@/lib/services/contacts";
import { ContactsTable } from "@/components/ContactsTable";
import { PageHeader } from "@/components/ui";
import { SearchIcon } from "@/components/Icons";

type Search = { q?: string; inactive?: string };

export default async function ContactsPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requirePagePermission("view");
  const s = await searchParams;
  const q = s.q?.trim() || undefined;
  const showInactive = s.inactive === "1";
  const contacts = await listAllContacts({ q, showInactive });
  const filtered = !!(q || showInactive);
  return (
    <>
      <PageHeader title="Contacts" subtitle="Everyone you talk to at your customers and suppliers." />
      <form className="toolbar" method="get" role="search">
        <label className="sr-only" htmlFor="q">
          Search contacts
        </label>
        <span className="search-box">
          <SearchIcon />
          <input id="q" name="q" type="search" defaultValue={q ?? ""} placeholder="Search name, email, phone or company" />
        </span>
        <label className="check">
          <input type="checkbox" name="inactive" value="1" defaultChecked={showInactive} /> Show inactive
        </label>
        <button className="btn secondary" type="submit">
          Search
        </button>
        {filtered ? (
          <Link className="btn secondary" href="/contacts">
            Clear
          </Link>
        ) : null}
      </form>
      <ContactsTable
        contacts={contacts}
        showOwner
        emptyLine={q ? `No contacts match “${q}”.` : "Contacts appear here once a customer or supplier has one."}
      />
    </>
  );
}
