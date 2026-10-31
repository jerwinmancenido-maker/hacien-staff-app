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
  BILL_STATUSES,
  BILLING_TX_STATUSES,
  COLLECTION_TX_STATUSES,
  CUSTOMER_TX_KINDS,
  listTransactions,
  PO_STATUSES,
  RR_STATUSES,
  SUPPLIER_TX_KINDS,
  TRANSACTION_KIND_LABELS,
  TRANSACTION_KINDS,
  type TransactionFilters,
  type TransactionKind,
} from "@/lib/services/transactions";
import type { ContactOwner } from "@/lib/services/contacts";
import { RecordList, type RecordItem } from "./RecordList";
import { EmptyState, type ChipTone } from "./ui";

const STATUS_TONE: Record<string, ChipTone> = {
  DRAFT: "grey",
  SENT: "amber",
  WON: "green",
  LOST: "grey",
  VOID: "red",
  OPEN: "green",
  APPROVED: "dark",
  PARTIALLY_RECEIVED: "amber",
  RECEIVED: "green",
  CLOSED: "grey",
  POSTED: "green",
  RECORDED: "green",
  PARTIALLY_PAID: "amber",
  PAID: "green",
  "OPEN|OVERDUE": "red",
  "PARTIALLY_PAID|OVERDUE": "red",
};
const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  WON: "Won",
  LOST: "Lost",
  VOID: "Void",
  OPEN: "Open",
  APPROVED: "Approved",
  PARTIALLY_RECEIVED: "Partially received",
  RECEIVED: "Received",
  CLOSED: "Closed",
  POSTED: "Posted",
  RECORDED: "Recorded",
  PARTIALLY_PAID: "Partially paid",
  PAID: "Paid",
  "OPEN|OVERDUE": "Overdue",
  "PARTIALLY_PAID|OVERDUE": "Overdue",
};
const AVATAR: Record<TransactionKind, string> = {
  QUOTE: "Q T",
  SALES_ORDER: "S O",
  PURCHASE_ORDER: "P O",
  RECEIVING_REPORT: "R R",
  SUPPLIER_BILL: "B L",
  BILLING: "B L",
  COLLECTION: "C R",
};
const AMOUNT_LABEL: Partial<Record<TransactionKind, string>> = {
  PURCHASE_ORDER: "PO total",
  RECEIVING_REPORT: "Value received",
  SUPPLIER_BILL: "Bill amount",
  BILLING: "Balance",
  COLLECTION: "Received",
};
const day = (ymd: string) => formatDate(new Date(`${ymd}T00:00:00.000Z`));

export type TransactionsSearch = { contact?: string; type?: string; status?: string; page?: string };

export function parseTransactionFilters(s: TransactionsSearch, contacts: Pick<Contact, "id">[]): TransactionFilters {
  const type = TRANSACTION_KINDS.includes(s.type as TransactionKind) ? (s.type as TransactionKind) : null;
  const statuses: string[] = [
    ...QUOTE_STATUSES,
    ...SALES_ORDER_STATUSES,
    ...PO_STATUSES,
    ...RR_STATUSES,
    ...BILL_STATUSES,
    ...BILLING_TX_STATUSES,
    ...COLLECTION_TX_STATUSES,
  ];
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
          line="Supplier POs, receiving reports and bills are cost information. Ask an admin to turn on “Can see costs” for you. Received quantities are on the Receiving page."
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
      avatarName: AVATAR[r.kind],
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
      amount: {
        label: AMOUNT_LABEL[r.kind] ?? (owner.kind === "supplier" ? "Amount" : "Contract total"),
        value: formatPeso(r.total),
        strong: true,
      },
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
          {(owner.kind === "customer" ? CUSTOMER_TX_KINDS : SUPPLIER_TX_KINDS).map((k) => (
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
          {owner.kind === "customer" && (
            <>
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
            </>
          )}
          {owner.kind === "supplier" && (
            <>
              <optgroup label="Supplier POs">
                {PO_STATUSES.filter((s) => !(["DRAFT", "SENT", "VOID"] as string[]).includes(s)).map((s) => (
                  <option key={`po-${s}`} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Receiving / bills">
                <option value="POSTED">Posted</option>
                <option value="RECORDED">Recorded</option>
              </optgroup>
            </>
          )}
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
          {owner.kind === "supplier" && " Supplier POs, receiving reports and bills are filtered by the PO's contact."}
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
              ? "Quotes, sales orders, billings and collections for this customer will show here."
              : "Supplier POs, receiving reports and bills for this supplier will show here."
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
                  <th className="num">{owner.kind === "supplier" ? "Amount" : "Contract total"}</th>
                  {owner.kind === "customer" && list.canSeeCosts && <th className="num">Supplier cost</th>}
                  {owner.kind === "customer" && list.canSeeCosts && <th className="num">Net margin</th>}
                  <th className="num">Void</th>
                </tr>
              </thead>
              <tbody>
                {list.totals.map((t) => (
                  <tr key={t.kind}>
                    <td>
                      {TRANSACTION_KIND_LABELS[t.kind]}s{AMOUNT_LABEL[t.kind] && <span className="small muted"> · {AMOUNT_LABEL[t.kind]?.toLowerCase()}</span>}
                    </td>
                    <td className="num">{t.count}</td>
                    <td className="num strong">{formatPeso(t.total)}</td>
                    {owner.kind === "customer" && list.canSeeCosts && (
                      <td className="num">{t.supplierCost !== undefined ? formatPeso(t.supplierCost) : "—"}</td>
                    )}
                    {owner.kind === "customer" && list.canSeeCosts && (
                      <td className="num">{t.netMargin !== undefined ? formatPeso(t.netMargin) : "—"}</td>
                    )}
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
