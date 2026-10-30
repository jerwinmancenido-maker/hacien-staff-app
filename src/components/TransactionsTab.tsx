// Transactions tab on customer and supplier pages (server component).
// ?tab=transactions&contact=<id>&type=QUOTE|SALES_ORDER&status=<status>&page=<n>
// Rows come from listTransactions(), which leaves cost fields out for users
// without "Can see costs".

import Link from "next/link";
import type { Contact } from "@prisma/client";
import { formatDate, formatPeso } from "@/lib/format";
import type { PermissionUser } from "@/lib/permissions";
import { QUOTE_STATUSES, SALES_ORDER_STATUSES } from "@/lib/quotes/views";
import {
  listTransactions,
  TRANSACTION_KIND_LABELS,
  TRANSACTION_KINDS,
  type TransactionFilters,
  type TransactionKind,
} from "@/lib/services/transactions";
import type { ContactOwner } from "@/lib/services/contacts";
import { RecordList, type RecordItem } from "./RecordList";
import { EmptyState, type ChipTone } from "./ui";

const STATUS_TONE: Record<string, ChipTone> = { DRAFT: "grey", SENT: "amber", WON: "green", LOST: "grey", VOID: "red", OPEN: "green" };
const STATUS_LABEL: Record<string, string> = { DRAFT: "Draft", SENT: "Sent", WON: "Won", LOST: "Lost", VOID: "Void", OPEN: "Open" };
const day = (ymd: string) => formatDate(new Date(`${ymd}T00:00:00.000Z`));

export type TransactionsSearch = { contact?: string; type?: string; status?: string; page?: string };

export function parseTransactionFilters(s: TransactionsSearch, contacts: Pick<Contact, "id">[]): TransactionFilters {
  const type = TRANSACTION_KINDS.includes(s.type as TransactionKind) ? (s.type as TransactionKind) : null;
  const statuses: string[] = [...QUOTE_STATUSES, ...SALES_ORDER_STATUSES];
  return {
    // Only this owner's contacts.
    contactId: contacts.some((c) => c.id === s.contact) ? s.contact! : null,
    type,
    status: s.status && statuses.includes(s.status) ? s.status : null,
    page: Math.max(1, Number.parseInt(s.page ?? "1", 10) || 1),
  };
}

export async function TransactionsTab({
  owner,
  user,
  contacts,
  search,
}: {
  owner: ContactOwner;
  user: PermissionUser;
  contacts: Contact[];
  search: TransactionsSearch;
}) {
  const basePath = `/${owner.kind === "customer" ? "customers" : "suppliers"}/${owner.id}`;
  const filters = parseTransactionFilters(search, contacts);
  const list = await listTransactions(owner, filters, user);

  const href = (patch: Partial<Record<"contact" | "type" | "status" | "page", string | null>>) => {
    const p = new URLSearchParams({ tab: "transactions" });
    const next = {
      contact: filters.contactId,
      type: filters.type,
      status: filters.status,
      page: filters.page && filters.page > 1 ? String(filters.page) : null,
      ...patch,
    };
    for (const [k, v] of Object.entries(next)) if (v) p.set(k, v);
    return `${basePath}?${p.toString()}`;
  };

  if (list.restricted) {
    return (
      <div className="card">
        <EmptyState
          title="Cost access needed"
          line="Which quotes and sales orders use this supplier is cost information. Ask an admin to turn on “Can see costs” for you. Supplier POs and bills will show here for everyone once they're built."
        />
      </div>
    );
  }

  const contactName = contacts.find((c) => c.id === filters.contactId)?.name;
  const items: RecordItem[] = list.rows.map((r) => {
    const cost =
      r.supplierCost !== undefined
        ? [
            { label: "Supplier cost", value: formatPeso(r.supplierCost) },
            { label: "Net margin", value: `${formatPeso(r.netMargin!)} (${r.netMarginPct}%)` },
          ]
        : [];
    return {
      id: `${r.kind}-${r.id}`,
      href: r.href,
      inactive: r.status === "VOID",
      avatarName: r.kind === "QUOTE" ? "Q T" : "S O",
      title: <Link href={r.href}>{r.number}</Link>,
      subtitle: (
        <>
          {TRANSACTION_KIND_LABELS[r.kind]} · {day(r.date)}
          {r.contactName ? ` · ${r.contactName}` : ""}
          {cost.length > 0 && (
            <span className="txn-cost">
              {" "}
              · Cost {formatPeso(r.supplierCost!)} · Margin {formatPeso(r.netMargin!)} ({r.netMarginPct}%)
            </span>
          )}
        </>
      ),
      chips: [{ label: STATUS_LABEL[r.status] ?? r.status, tone: STATUS_TONE[r.status] ?? "grey" }],
      meta: [
        { label: "Type", value: TRANSACTION_KIND_LABELS[r.kind] },
        { label: "Date", value: day(r.date) },
        { label: "Contact", value: r.contactName ?? "—" },
        ...cost,
      ],
      amount: { label: owner.kind === "supplier" ? "This supplier's lines" : "Contract total", value: formatPeso(r.total), strong: true },
      sortValues: { date: r.date, number: r.number, total: Number(r.total) },
    };
  });

  return (
    <div className="txn-tab">
      <form className="toolbar txn-filters" action={basePath} method="get" aria-label="Filter transactions">
        <input type="hidden" name="tab" value="transactions" />
        <label className="sr-only" htmlFor="txn-contact">
          Contact person
        </label>
        <select id="txn-contact" name="contact" defaultValue={filters.contactId ?? ""} className="input">
          <option value="">All contacts</option>
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {!c.active ? " (inactive)" : ""}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="txn-type">
          Type
        </label>
        <select id="txn-type" name="type" defaultValue={filters.type ?? ""} className="input">
          <option value="">All types</option>
          {TRANSACTION_KINDS.map((k) => (
            <option key={k} value={k}>
              {TRANSACTION_KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="txn-status">
          Status
        </label>
        <select id="txn-status" name="status" defaultValue={filters.status ?? ""} className="input">
          <option value="">All statuses</option>
          <optgroup label="Quotes">
            {QUOTE_STATUSES.map((s) => (
              <option key={`q-${s}`} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </optgroup>
          <optgroup label="Sales orders">
            {SALES_ORDER_STATUSES.filter((s) => !(QUOTE_STATUSES as string[]).includes(s)).map((s) => (
              <option key={`so-${s}`} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </optgroup>
        </select>
        <button type="submit" className="btn btn-secondary btn-sm">
          Filter
        </button>
        {(filters.contactId || filters.type || filters.status) && (
          <Link className="btn-link small" href={`${basePath}?tab=transactions`}>
            Clear
          </Link>
        )}
      </form>

      {contactName && (
        <div className="small muted txn-contact-note">
          Showing transactions with <strong>{contactName}</strong>.
          {owner.kind === "supplier" && " Supplier contacts aren't linked to quote or SO lines; they'll link to supplier POs and bills when those are built."}
        </div>
      )}

      <RecordList
        listKey="transactions"
        label="Transactions"
        items={items}
        emptyTitle="No transactions"
        emptyLine={
          filters.contactId || filters.type || filters.status
            ? "Nothing matches these filters."
            : owner.kind === "customer"
              ? "Quotes and sales orders for this customer will show here."
              : "Quotes and sales orders with lines from this supplier will show here."
        }
      />

      {list.pages > 1 && (
        <nav className="pager" aria-label="Pages">
          {filters.page! > 1 ? (
            <Link className="btn btn-secondary btn-sm" href={href({ page: String(filters.page! - 1) })}>
              ← Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="small muted">
            Page {list.page} of {list.pages} · {list.totalRows} documents
          </span>
          {filters.page! < list.pages ? (
            <Link className="btn btn-secondary btn-sm" href={href({ page: String(filters.page! + 1) })}>
              Older →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}

      {list.totals.length > 0 && (
        <div className="card txn-totals">
          <div className="card-head">
            <h2>Totals</h2>
            <div className="right small faint">All pages · void documents not included</div>
          </div>
          <div className="table-wrap">
            <table className="list" aria-label="Transaction totals">
              <thead>
                <tr>
                  <th>Type</th>
                  <th className="num">Documents</th>
                  <th className="num">{owner.kind === "supplier" ? "This supplier's lines" : "Contract total"}</th>
                  {list.canSeeCosts && <th className="num">Supplier cost</th>}
                  {list.canSeeCosts && <th className="num">Net margin</th>}
                  <th className="num">Void</th>
                </tr>
              </thead>
              <tbody>
                {list.totals.map((t) => (
                  <tr key={t.kind}>
                    <td>{TRANSACTION_KIND_LABELS[t.kind]}s</td>
                    <td className="num">{t.count}</td>
                    <td className="num strong">{formatPeso(t.total)}</td>
                    {list.canSeeCosts && <td className="num">{formatPeso(t.supplierCost ?? "0")}</td>}
                    {list.canSeeCosts && <td className="num">{formatPeso(t.netMargin ?? "0")}</td>}
                    <td className="num">{t.voidCount > 0 ? `${t.voidCount} void` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
