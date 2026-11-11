import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/current-user";
import { canSeeTin } from "@/lib/permissions";
import { listBillings, BILLING_STATUS_LABELS } from "@/lib/billing/views";
import { listPurchaseOrdersView, listReceivingView } from "@/lib/purchasing/views";
import { PO_STATUS_LABELS } from "@/lib/purchasing/status";
import { listQuotesView, listSalesOrdersView } from "@/lib/quotes/views";
import { listCustomers, listSuppliers } from "@/lib/services/companies";
import { QUOTE_STATUS_LABELS, SO_STATUS_LABELS } from "@/components/docs/DocParts";
import { EmptyState, PageHeader } from "@/components/ui";
import {
  mergeReceivingSearchRows,
  normalizeTopSearchQuery,
  takeTopSearchHits,
  topSearchListHref,
  type TopSearchHit,
} from "@/lib/search/top-search";

type SearchParams = { q?: string };

type SearchGroup = {
  key: string;
  title: string;
  seeAllLabel: string;
  seeAllHref: string;
  hits: TopSearchHit[];
};

function rowLine(hit: TopSearchHit) {
  return `${hit.primary} · ${hit.secondary} · ${hit.status}`;
}

export default async function TopSearchPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePagePermission("view");
  const sp = await searchParams;
  const q = normalizeTopSearchQuery(sp.q);

  if (!q) {
    return (
      <>
        <PageHeader title="Search" subtitle="Type at least 2 characters in the header search box." />
        <div className="card">
          <EmptyState title="Nothing to search" line="Try a number, a name, or a serial." />
        </div>
      </>
    );
  }

  const showTin = canSeeTin(user);
  const [quotes, salesOrders, customers, suppliers, purchaseOrders, receivingOpen, receivingHistory, billings] =
    await Promise.all([
      listQuotesView({ q }, user),
      listSalesOrdersView({ q }),
      listCustomers({ q, matchTin: showTin }),
      listSuppliers({ q, matchTin: showTin }),
      listPurchaseOrdersView({ q }, user),
      listReceivingView({ q }, user),
      listReceivingView({ q, history: true }, user),
      listBillings({ q }),
    ]);

  const receiving = mergeReceivingSearchRows(receivingOpen, receivingHistory);

  const groups: SearchGroup[] = [
    {
      key: "quotes",
      title: "Quotes",
      seeAllLabel: "See all in Quotes →",
      seeAllHref: topSearchListHref("/quotes", q),
      hits: takeTopSearchHits(quotes, (r) => ({
        id: r.id,
        href: `/quotes/${r.id}`,
        primary: r.number,
        secondary: r.customerName,
        status: QUOTE_STATUS_LABELS[r.status] ?? r.status,
      })),
    },
    {
      key: "sales-orders",
      title: "Sales orders",
      seeAllLabel: "See all in Sales orders →",
      seeAllHref: topSearchListHref("/sales-orders", q),
      hits: takeTopSearchHits(salesOrders, (r) => ({
        id: r.id,
        href: `/sales-orders/${r.id}`,
        primary: r.number,
        secondary: r.customerName,
        status: SO_STATUS_LABELS[r.status] ?? r.status,
      })),
    },
    {
      key: "customers",
      title: "Customers",
      seeAllLabel: "See all in Customers →",
      seeAllHref: topSearchListHref("/customers", q),
      hits: takeTopSearchHits(customers, (r) => ({
        id: r.id,
        href: `/customers/${r.id}`,
        primary: r.name,
        secondary: showTin && r.tin ? r.tin : "—",
        status: r.active ? "Active" : "Inactive",
      })),
    },
    {
      key: "suppliers",
      title: "Suppliers",
      seeAllLabel: "See all in Suppliers →",
      seeAllHref: topSearchListHref("/suppliers", q),
      hits: takeTopSearchHits(suppliers, (r) => ({
        id: r.id,
        href: `/suppliers/${r.id}`,
        primary: r.name,
        secondary: showTin && r.tin ? r.tin : "—",
        status: r.active ? "Active" : "Inactive",
      })),
    },
    {
      key: "purchase-orders",
      title: "Supplier POs",
      seeAllLabel: "See all in Supplier POs →",
      seeAllHref: topSearchListHref("/purchase-orders", q),
      hits: takeTopSearchHits(purchaseOrders, (r) => ({
        id: r.id,
        href: `/purchase-orders/${r.id}`,
        primary: r.number,
        secondary: r.supplierName,
        status: PO_STATUS_LABELS[r.status] ?? r.status,
      })),
    },
    {
      key: "receiving",
      title: "Receiving",
      seeAllLabel: "See all in Receiving →",
      seeAllHref: topSearchListHref("/receiving", q),
      hits: takeTopSearchHits(receiving, (r) => ({
        id: r.id,
        href: `/receiving/${r.id}`,
        primary: r.number,
        secondary: r.supplier.name,
        status: PO_STATUS_LABELS[r.status] ?? r.status,
      })),
    },
    {
      key: "billings",
      title: "Billings",
      seeAllLabel: "See all in Billings →",
      seeAllHref: topSearchListHref("/billing/billings", q),
      hits: takeTopSearchHits(billings, (r) => ({
        id: r.id,
        href: `/billing/billings/${r.id}`,
        primary: String(r.invoiceNo),
        secondary: r.customer.name,
        status: BILLING_STATUS_LABELS[r.status] ?? r.status,
      })),
    },
  ].filter((g) => g.hits.length > 0);

  return (
    <>
      <PageHeader title={`Results for “${q}”`} subtitle="Matches from lists you can already open." />
      {groups.length === 0 ? (
        <div className="card">
          <EmptyState title="No matches" line="Try a number, a name, or a serial." />
        </div>
      ) : (
        <div className="top-search-results">
          {groups.map((group) => (
            <section key={group.key} className="top-search-group" aria-labelledby={`top-search-${group.key}`}>
              <h2 id={`top-search-${group.key}`} className="top-search-group-title">
                {group.title}
              </h2>
              <ul className="plain-list top-search-hits">
                {group.hits.map((hit) => (
                  <li key={hit.id}>
                    <Link href={hit.href} className="top-search-hit">
                      {rowLine(hit)}
                    </Link>
                  </li>
                ))}
              </ul>
              <Link href={group.seeAllHref} className="top-search-see-all">
                {group.seeAllLabel}
              </Link>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
