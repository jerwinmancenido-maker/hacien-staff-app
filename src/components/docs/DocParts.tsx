// Read-only pieces of the quote and sales order pages (server-safe, no hooks):
// status chips, the items table and the totals box. Cost columns/rows render
// only when the view carries them (the server omits them for non-cost users).

import type { ReactNode } from "react";
import { formatPeso } from "@/lib/format";
import { Chip, type ChipTone } from "@/components/ui";
import { COST_NOT_SET_LABEL, lineCostMissing, supplierCostMissing, type SupplierCostState } from "@/lib/quotes/calc";
import { FALLBACK_SHORT_NAME } from "@/lib/settings/identity";

export const QUOTE_STATUS_LABELS: Record<string, string> = { DRAFT: "Draft", SENT: "Sent", WON: "Won", LOST: "Lost", VOID: "Void" };
const QUOTE_TONES: Record<string, ChipTone> = { DRAFT: "grey", SENT: "blue", WON: "green", LOST: "red", VOID: "red" };

export const SO_STATUS_LABELS: Record<string, string> = { OPEN: "Open", VOID: "Void", CLOSED: "Closed" };
const SO_TONES: Record<string, ChipTone> = { OPEN: "green", VOID: "red", CLOSED: "blue" };

export function QuoteStatusChip({ status }: { status: string }) {
  return <Chip tone={QUOTE_TONES[status]}>{QUOTE_STATUS_LABELS[status] ?? status}</Chip>;
}

export function SoStatusChip({ status }: { status: string }) {
  return <Chip tone={SO_TONES[status]}>{SO_STATUS_LABELS[status] ?? status}</Chip>;
}

/** Soft margin/total advisory (not the workflow approval chip). Hidden once workflow-approved. */
export function ApprovalChip({
  approval,
  workflowApproved = false,
}: {
  approval: { needed: boolean; reasons?: string[] };
  /** When true (approvalStatus === APPROVED), hide this advisory chip. */
  workflowApproved?: boolean;
}) {
  if (workflowApproved || !approval.needed) return null;
  const costNotSet = approval.reasons?.includes(COST_NOT_SET_LABEL);
  return (
    <span title={approval.reasons?.join(" · ")}>
      <Chip tone="amber">{costNotSet ? COST_NOT_SET_LABEL : "Low margin / over threshold"}</Chip>
    </span>
  );
}

/** S-18 workflow approval (Waiting / Approved / Rejected / Not required). */
export function QuoteWorkflowApprovalChip({
  status,
  label,
}: {
  status: "PENDING" | "APPROVED" | "REJECTED" | "NOT_REQUIRED";
  label: string;
}) {
  const tone: ChipTone = status === "APPROVED" ? "green" : status === "REJECTED" ? "red" : "grey";
  return <Chip tone={tone}>{label}</Chip>;
}

export type ItemsTableRow = {
  id: string;
  description: string;
  kind: string;
  qty: string;
  unit: string;
  unitPrice: string;
  total: string;
  withholdingRate?: string | null;
  withholdingAtc?: string | null;
  withholdingOverride?: boolean;
  overrideNote?: string | null;
  /** Part A: "Changed vs quote" differences + the quote-vs-now summary. */
  changedVsQuote?: string[];
  changedSummary?: string;
  supplierName?: string | null;
  supplierUnitCost?: string;
  supplierTotal?: string;
  margin?: string;
  isLot?: boolean;
  components?: { unitCost: string }[];
};

const qtyText = (q: string) => q.replace(/\.00$/, "");

export function ItemsTable({
  items,
  showCosts,
  shortName = FALLBACK_SHORT_NAME,
}: {
  items: ItemsTableRow[];
  showCosts: boolean;
  /** Own-company name for the price column header (Settings → Company). */
  shortName?: string;
}) {
  return (
    <div className="table-wrap items-table">
      <table className="list" aria-label="Items">
        <thead>
          <tr>
            <th>#</th>
            <th>Description</th>
            <th className="num">Qty</th>
            <th className="col-tab-hide">Unit</th>
            {showCosts && <th className="col-phone-hide">Supplier</th>}
            {showCosts && <th className="num col-phone-hide">Supplier unit</th>}
            {showCosts && <th className="num" style={{ whiteSpace: "nowrap" }}>Supplier total</th>}
            <th className="num" style={{ whiteSpace: "nowrap" }}>{shortName} price</th>
            <th className="num">Total</th>
            {showCosts && <th className="num">Margin</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((i, n) => (
            <tr key={i.id}>
              <td className="faint">{n + 1}</td>
              <td>
                <div className="strong items-desc" title={i.description} style={{ whiteSpace: "pre-wrap" }}>
                  {i.description}
                </div>
                <div className="small muted">{i.kind === "SERVICES" ? "Services" : "Goods"}</div>
                {i.overrideNote ? <div className="small muted">{i.overrideNote}</div> : null}
                {i.changedVsQuote?.length ? (
                  <div className="small muted" title={i.changedSummary}>
                    <span className="chip dark">Changed</span> vs quote: {i.changedVsQuote.join(" · ")}
                  </div>
                ) : null}
                {(i.withholdingRate != null || i.withholdingAtc) && (
                  <div className="small faint">
                    WH {i.withholdingRate != null ? `${(Number(i.withholdingRate) * 100).toFixed(2).replace(/\.?0+$/, "")}%` : "—"}
                    {i.withholdingAtc ? ` · ${i.withholdingAtc}` : ""}
                  </div>
                )}
              </td>
              <td className="num">{qtyText(i.qty)}</td>
              <td className="col-tab-hide">{i.unit}</td>
              {showCosts && <td className="col-phone-hide">{i.isLot ? <span className="faint">Lot</span> : (i.supplierName ?? <span className="faint">—</span>)}</td>}
              {showCosts && <td className="num col-phone-hide">{i.isLot ? <span className="faint">—</span> : formatPeso(i.supplierUnitCost ?? 0)}</td>}
              {showCosts && <td className="num">{formatPeso(i.supplierTotal ?? 0)}</td>}
              <td className="num">{formatPeso(i.unitPrice)}</td>
              <td className="num strong">{formatPeso(i.total)}</td>
              {showCosts && (
                <td className={`num${lineCostMissing(i) ? "" : Number(i.margin) < 0 ? " neg" : ""}`}>
                  {lineCostMissing(i) ? COST_NOT_SET_LABEL : formatPeso(i.margin ?? 0)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export type TotalsBoxData = {
  contractPrice: string;
  withholding: { code: string; label: string; pctLabel?: string; amount: string }[];
  withholdingTotal: string;
  netReceived: string;
  supplierCost?: string;
  netMargin?: string;
  netMarginPct?: string;
  supplierCostState?: SupplierCostState;
};

function totalsCostState(totals: TotalsBoxData): SupplierCostState {
  if (totals.supplierCostState) return totals.supplierCostState;
  if (totals.supplierCost !== undefined && supplierCostMissing(totals.supplierCost)) return "none";
  return "full";
}

function MarginRow({ totals }: { totals: TotalsBoxData }) {
  const state = totalsCostState(totals);
  const label = state === "partial" ? "Margin so far" : "Margin";
  return (
    <div className={`totals-row strong${state !== "none" && Number(totals.netMargin) < 0 ? " neg" : ""}`}>
      <span>
        {label}
        <div className="small faint" style={{ fontWeight: 400 }}>
          {state === "none" ? "Supplier cost is blank" : "Contract price minus supplier cost"}
        </div>
      </span>
      <span className="num">
        {state === "none" ? (
          COST_NOT_SET_LABEL
        ) : (
          <>
            {/* D8: in the partial state the stored percent prices the
                missing lines at ₱0 — keep the peso "Margin so far" but
                show no percent until every line has a cost. */}
            {formatPeso(totals.netMargin ?? 0)} <span className="muted">({state === "partial" ? "—" : `${totals.netMarginPct}%`})</span>
          </>
        )}
      </span>
    </div>
  );
}

function Row({ label, value, strong, sub }: { label: ReactNode; value: string; strong?: boolean; sub?: boolean }) {
  return (
    <div className={`totals-row${strong ? " strong" : ""}${sub ? " sub" : ""}`}>
      <span>{label}</span>
      <span className="num">{value}</span>
    </div>
  );
}

/** Totals box: contract price, withholding (itemised), cash after WH; then supplier cost and margin (WH is not a cost). */
export function TotalsBox({ totals, showCosts }: { totals: TotalsBoxData; showCosts: boolean }) {
  return (
    <div className="totals-box" aria-label="Totals">
      <Row label="Contract price" value={formatPeso(totals.contractPrice)} strong />
      {totals.withholding.length === 0 ? (
        <Row
          label="Less withholding"
          value={Number(totals.withholdingTotal) ? `−${formatPeso(totals.withholdingTotal)}` : formatPeso(0)}
        />
      ) : (
        <>
          <div className="totals-row">
            <span>Less withholding</span>
          </div>
          {totals.withholding.map((w) => (
            <Row key={w.code} label={w.label} value={`−${formatPeso(w.amount)}`} sub />
          ))}
          <Row label="Total withholding" value={`−${formatPeso(totals.withholdingTotal)}`} />
        </>
      )}
      <Row label="Cash we receive after withholding" value={formatPeso(totals.netReceived)} strong />
      {showCosts && totals.supplierCost !== undefined && (
        <>
          <div className="totals-sep" />
          <Row
            label="Supplier cost"
            value={Number(totals.supplierCost) ? `−${formatPeso(totals.supplierCost)}` : formatPeso(0)}
          />
          <MarginRow totals={totals} />
        </>
      )}
    </div>
  );
}
