// Read-only pieces of the quote and sales order pages (server-safe, no hooks):
// status chips, the items table and the totals box. Cost columns/rows render
// only when the view carries them (the server omits them for non-cost users).

import type { ReactNode } from "react";
import { formatPeso } from "@/lib/format";
import { Chip, type ChipTone } from "@/components/ui";

export const QUOTE_STATUS_LABELS: Record<string, string> = { DRAFT: "Draft", SENT: "Sent", WON: "Won", LOST: "Lost", VOID: "Void" };
const QUOTE_TONES: Record<string, ChipTone> = { DRAFT: "grey", SENT: "amber", WON: "green", LOST: "red", VOID: "red" };

export const SO_STATUS_LABELS: Record<string, string> = { OPEN: "Open", VOID: "Void" };
const SO_TONES: Record<string, ChipTone> = { OPEN: "green", VOID: "red" };

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
  return (
    <span title={approval.reasons?.join(" · ")}>
      <Chip tone="amber">Low margin / over threshold</Chip>
    </span>
  );
}

/** S-18 workflow approval (Waiting / Approved / Rejected). */
export function QuoteWorkflowApprovalChip({
  status,
  label,
}: {
  status: "PENDING" | "APPROVED" | "REJECTED";
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
  supplierName?: string | null;
  supplierUnitCost?: string;
  supplierTotal?: string;
  margin?: string;
};

const qtyText = (q: string) => q.replace(/\.00$/, "");

export function ItemsTable({ items, showCosts }: { items: ItemsTableRow[]; showCosts: boolean }) {
  return (
    <div className="table-wrap items-table">
      <table className="list" aria-label="Items">
        <thead>
          <tr>
            <th>#</th>
            <th>Description</th>
            <th className="num">Qty</th>
            <th>Unit</th>
            {showCosts && <th>Supplier</th>}
            {showCosts && <th className="num">Supplier unit</th>}
            {showCosts && <th className="num">Supplier total</th>}
            <th className="num">HACIEN price</th>
            <th className="num">Total</th>
            {showCosts && <th className="num">Margin</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((i, n) => (
            <tr key={i.id}>
              <td className="faint">{n + 1}</td>
              <td>
                <div className="strong" style={{ whiteSpace: "pre-wrap" }}>
                  {i.description}
                </div>
                <div className="small muted">{i.kind === "SERVICES" ? "Services" : "Goods"}</div>
                {i.overrideNote ? <div className="small muted">{i.overrideNote}</div> : null}
                {(i.withholdingRate != null || i.withholdingAtc) && (
                  <div className="small faint">
                    WH {i.withholdingRate != null ? `${(Number(i.withholdingRate) * 100).toFixed(2).replace(/\.?0+$/, "")}%` : "—"}
                    {i.withholdingAtc ? ` · ${i.withholdingAtc}` : ""}
                  </div>
                )}
              </td>
              <td className="num">{qtyText(i.qty)}</td>
              <td>{i.unit}</td>
              {showCosts && <td>{i.supplierName ?? <span className="faint">—</span>}</td>}
              {showCosts && <td className="num">{formatPeso(i.supplierUnitCost ?? 0)}</td>}
              {showCosts && <td className="num">{formatPeso(i.supplierTotal ?? 0)}</td>}
              <td className="num">{formatPeso(i.unitPrice)}</td>
              <td className="num strong">{formatPeso(i.total)}</td>
              {showCosts && <td className={`num${Number(i.margin) < 0 ? " neg" : ""}`}>{formatPeso(i.margin ?? 0)}</td>}
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
};

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
          <Row label="Supplier cost" value={`−${formatPeso(totals.supplierCost)}`} />
          <div className={`totals-row strong${Number(totals.netMargin) < 0 ? " neg" : ""}`}>
            <span>
              Margin
              <div className="small faint" style={{ fontWeight: 400 }}>
                Contract price minus supplier cost
              </div>
            </span>
            <span className="num">
              {formatPeso(totals.netMargin ?? 0)} <span className="muted">({totals.netMarginPct}%)</span>
            </span>
          </div>
        </>
      )}
    </div>
  );
}
