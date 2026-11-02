import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { getBookletView } from "@/lib/billing/views";
import { formatBookletNumber, type BookletType } from "@/lib/billing/booklet";
import { BillingNav } from "@/components/billing/BillingNav";
import { MarkSpoiledForm } from "@/components/billing/MarkSpoiledForm";
import { PageHeader } from "@/components/ui";

const DOC_TYPE_TABS: { key: BookletType; label: string }[] = [
  { key: "SI", label: "Sales Invoice (SI)" },
  { key: "DR", label: "Delivery Receipt (DR)" },
  { key: "CR", label: "Collection Receipt (CR)" },
];

export default async function BookletPage({
  searchParams,
}: {
  searchParams?: Promise<{ type?: string }>;
}) {
  const user = await requirePagePermission("view");
  const sp = searchParams ? await searchParams : {};
  const docType = (sp.type === "DR" || sp.type === "CR" ? sp.type : "SI") as BookletType;
  const view = await getBookletView(docType);
  const canSettings = can(user, "manage_settings");
  const canRecord = can(user, "record_billing");

  return (
    <>
      <PageHeader
        title={`${view.typeName} booklet`}
        subtitle={`Serials ${formatBookletNumber(view.range.seriesFrom)}–${formatBookletNumber(view.range.seriesTo)}. Used ${view.usedCount} · voided ${view.voidedCount} · spoiled ${view.spoiledCount} · free ${view.freeCount}${
          view.nextFree != null ? ` · next free ${formatBookletNumber(view.nextFree)}` : ""
        }. Voided and spoiled numbers are never reused.`}
        actions={
          <div className="button-group" style={{ display: "flex", gap: 8 }}>
            {canRecord && (
              <MarkSpoiledForm
                type={docType}
                typeName={view.typeName}
                nextFree={view.nextFree}
              />
            )}
            {canSettings && (
              <Link className="btn btn-secondary" href="/settings?tab=billing">
                Booklet settings
              </Link>
            )}
          </div>
        }
      />
      <BillingNav active="booklet" />

      {view.warning && (
        <div className="alert warn" role="alert" style={{ marginBottom: 16 }}>
          {view.warning}
        </div>
      )}

      <div className="tabs" style={{ marginBottom: 16, display: "flex", gap: 8 }}>
        {DOC_TYPE_TABS.map((tab) => {
          const active = tab.key === docType;
          return (
            <Link
              key={tab.key}
              href={`/billing/booklet?type=${tab.key}`}
              className={`btn ${active ? "btn-primary" : "btn-secondary"}`}
              style={{ fontSize: 13 }}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 className="section-title" style={{ marginTop: 0 }}>Authority to Print (ATP)</h3>
        <dl className="kv-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, margin: 0 }}>
          <div>
            <dt className="faint small">ATP no.</dt>
            <dd className="strong num">{view.range.atpNo || "—"}</dd>
          </div>
          <div>
            <dt className="faint small">ATP date</dt>
            <dd className="strong">{view.range.atpDate || "—"}</dd>
          </div>
          <div>
            <dt className="faint small">Printer</dt>
            <dd className="strong">{view.range.printer || "—"}</dd>
          </div>
          <div>
            <dt className="faint small">Serials range</dt>
            <dd className="strong num">{formatBookletNumber(view.range.seriesFrom)}–{formatBookletNumber(view.range.seriesTo)}</dd>
          </div>
          <div>
            <dt className="faint small">Booklets</dt>
            <dd className="strong">{view.range.bookletCount ?? 10} × {view.range.setsPerBooklet ?? 50} sets</dd>
          </div>
          <div>
            <dt className="faint small">Tax type</dt>
            <dd className="strong">{view.range.isNonVat === false ? "VAT" : "NON-VAT"}</dd>
          </div>
        </dl>
      </div>

      <div className="card">
        <div className="booklet-grid" role="list" aria-label="Booklet numbers">
          {view.slots.map((s) => (
            <div
              key={s.invoiceNo}
              role="listitem"
              className={`booklet-cell booklet-${s.status}`}
              title={
                s.status === "spoiled"
                  ? `Spoiled: ${s.spoiledReason ?? "Marked spoiled"}`
                  : s.billingNumber
                    ? `${s.status}: ${s.billingNumber}`
                    : s.status
              }
            >
              {s.billingId ? (
                <Link href={`/billing/billings/${s.billingId}`}>{formatBookletNumber(s.invoiceNo)}</Link>
              ) : (
                <span>{formatBookletNumber(s.invoiceNo)}</span>
              )}
            </div>
          ))}
        </div>
        <div className="booklet-legend faint small" style={{ marginTop: 12 }}>
          <span className="booklet-swatch booklet-free" /> Free{" "}
          <span className="booklet-swatch booklet-used" /> Used{" "}
          <span className="booklet-swatch booklet-voided" /> Voided (kept){" "}
          <span className="booklet-swatch booklet-spoiled" /> Spoiled (kept)
        </div>
      </div>
    </>
  );
}
