import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { getBookletView } from "@/lib/billing/views";
import { BillingNav } from "@/components/billing/BillingNav";
import { PageHeader } from "@/components/ui";

export default async function BookletPage() {
  const user = await requirePagePermission("view");
  const view = await getBookletView();
  const canSettings = can(user, "manage_settings");

  return (
    <>
      <PageHeader
        title={view.range.label || "Invoice booklet"}
        subtitle={`Numbers ${view.range.seriesFrom}–${view.range.seriesTo}. Used ${view.usedCount} · voided ${view.voidedCount} · free ${view.freeCount}${
          view.nextFree != null ? ` · next free ${view.nextFree}` : ""
        }. Voided numbers are never reused.`}
        actions={
          canSettings && (
            <Link className="btn btn-secondary" href="/settings?tab=billing">
              Booklet settings
            </Link>
          )
        }
      />
      <BillingNav active="booklet" />
      <div className="card">
        <div className="booklet-grid" role="list" aria-label="Booklet numbers">
          {view.slots.map((s) => (
            <div
              key={s.invoiceNo}
              role="listitem"
              className={`booklet-cell booklet-${s.status}`}
              title={s.billingNumber ? `${s.status}: ${s.billingNumber}` : s.status}
            >
              {s.billingId ? (
                <Link href={`/billing/billings/${s.billingId}`}>{s.invoiceNo}</Link>
              ) : (
                <span>{s.invoiceNo}</span>
              )}
            </div>
          ))}
        </div>
        <div className="booklet-legend faint small" style={{ marginTop: 12 }}>
          <span className="booklet-swatch booklet-free" /> Free{" "}
          <span className="booklet-swatch booklet-used" /> Used{" "}
          <span className="booklet-swatch booklet-voided" /> Voided (kept)
        </div>
      </div>
    </>
  );
}
