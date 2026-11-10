"use client";

// Selection-first "Create POs" (REQ-PO-FLOW-002 / 003). Tick open SO lines
// and lot components, pick a supplier on every row (default = quote/SO),
// set qty up to the remainder, confirm ₱0 costs, review the grouped draft
// POs, then create them in one submit. Cost stays the quote cost.

import { Fragment, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useFormAction } from "@/components/useFormAction";
import { Chip, PageHeader } from "@/components/ui";
import { formatPeso } from "@/lib/format";
import { fromScaled, lineAmounts, toScaled, type ItemKind } from "@/lib/quotes/calc";
import { planPoSelection, selectionIssueSummary, type PoSelectionInput } from "@/lib/purchasing/plan";
import type { FormState } from "@/lib/validation/forms";

export type PreviewPoRef = { id: string; number: string; qty: string };

export type PreviewComponent = {
  id: string;
  sortOrder: number;
  description: string;
  qty: string;
  unit: string;
  supplierId: string | null;
  supplierName: string | null;
  unitCost: string;
  orderedQty: string;
  remainingQty: string;
  purchaseOrders: PreviewPoRef[];
  purchaseOrder: { id: string; number: string } | null;
};

export type PreviewLine = {
  id: string;
  sortOrder: number;
  description: string;
  kind: ItemKind;
  qty: string;
  unit: string;
  supplierId: string | null;
  supplierName: string | null;
  supplierUnitCost: string;
  orderedQty: string;
  remainingQty: string;
  purchaseOrders: PreviewPoRef[];
  purchaseOrder: { id: string; number: string } | null;
  isLot?: boolean;
  components?: PreviewComponent[];
};

type OpenRow = {
  key: string;
  salesOrderItemId: string;
  salesOrderItemComponentId: string | null;
  description: string;
  kind: ItemKind;
  unit: string;
  soQty: string;
  orderedQty: string;
  remainingQty: string;
  unitCost: string;
  quoteSupplierId: string | null;
  quoteSupplierName: string | null;
  purchaseOrders: PreviewPoRef[];
  lotDescription: string | null;
  sortOrder: number;
  locked: boolean;
};

type RowState = { checked: boolean; qty: string; supplierId: string; confirmZero: boolean };

const showQty = (q: string) => q.replace(/\.00$/, "");
const isZeroCost = (cost: string) => {
  try {
    return toScaled(cost || "0", 2) === 0n;
  } catch {
    return false;
  }
};
const lineTotal = (qty: string, cost: string): string | null => {
  const q = qty.trim().replace(/,/g, "");
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(q)) return null;
  return lineAmounts({ kind: "GOODS", qty: q, unitPrice: cost, supplierUnitCost: "0" }).total;
};
const pesoSum = (items: readonly { qty: string; unitCost: string }[]) =>
  fromScaled(
    items.reduce((acc, line) => acc + toScaled(lineTotal(line.qty, line.unitCost) ?? "0", 2), 0n),
    2,
  );

function flatten(lines: PreviewLine[]): OpenRow[] {
  const rows: OpenRow[] = [];
  for (const line of lines) {
    if (line.isLot) {
      for (const c of line.components ?? []) {
        rows.push({
          key: c.id,
          salesOrderItemId: line.id,
          salesOrderItemComponentId: c.id,
          description: c.description,
          kind: line.kind,
          unit: c.unit,
          soQty: c.qty,
          orderedQty: c.orderedQty,
          remainingQty: c.remainingQty,
          unitCost: c.unitCost,
          quoteSupplierId: c.supplierId,
          quoteSupplierName: c.supplierName,
          purchaseOrders: c.purchaseOrders ?? [],
          lotDescription: line.description,
          sortOrder: line.sortOrder * 1000 + c.sortOrder,
          locked: toScaled(c.remainingQty || "0", 2) <= 0n,
        });
      }
      continue;
    }
    rows.push({
      key: line.id,
      salesOrderItemId: line.id,
      salesOrderItemComponentId: null,
      description: line.description,
      kind: line.kind,
      unit: line.unit,
      soQty: line.qty,
      orderedQty: line.orderedQty,
      remainingQty: line.remainingQty,
      unitCost: line.supplierUnitCost,
      quoteSupplierId: line.supplierId,
      quoteSupplierName: line.supplierName,
      purchaseOrders: line.purchaseOrders ?? [],
      lotDescription: null,
      sortOrder: line.sortOrder * 1000,
      locked: toScaled(line.remainingQty || "0", 2) <= 0n,
    });
  }
  return rows;
}

function initialRow(row: OpenRow): RowState {
  return {
    checked: !row.locked,
    qty: showQty(row.remainingQty),
    supplierId: row.quoteSupplierId ?? "",
    confirmZero: false,
  };
}

export function CreatePosForm({
  soNumber,
  customerName,
  lines,
  suppliers,
  defaultDate,
  defaultAddress,
  action,
  cancelHref,
}: {
  soNumber: string;
  customerName: string;
  lines: PreviewLine[];
  suppliers: { id: string; name: string }[];
  defaultDate: string;
  defaultAddress: string;
  action: (state: FormState, form: FormData) => Promise<FormState>;
  cancelHref: string;
}) {
  const [step, setStep] = useState<"select" | "review">("select");
  const idempotencyKey = useRef("");
  const { state, pending, onSubmit } = useFormAction(async (prev, form) => {
    const result = await action(prev, form);
    if (result.message && !result.ok) setStep("select");
    return result;
  });
  const rows = useMemo(() => flatten(lines), [lines]);
  const [draft, setDraft] = useState<Record<string, RowState>>(() => Object.fromEntries(rows.map((r) => [r.key, initialRow(r)])));
  const [header, setHeader] = useState({ date: defaultDate, expectedDate: "", deliveryAddressText: defaultAddress });
  const names = useMemo(() => {
    const map = new Map(suppliers.map((s) => [s.id, s.name]));
    for (const row of rows) if (row.quoteSupplierId && row.quoteSupplierName) map.set(row.quoteSupplierId, row.quoteSupplierName);
    return map;
  }, [rows, suppliers]);

  const open = rows.filter((r) => !r.locked);
  const lockedCount = rows.length - open.length;
  const allChecked = open.length > 0 && open.every((r) => draft[r.key]?.checked);
  const checked = open.filter((r) => draft[r.key]?.checked);
  const selection: PoSelectionInput[] = checked.map((row) => {
    const cur = draft[row.key] ?? initialRow(row);
    return {
      key: row.key,
      salesOrderItemId: row.salesOrderItemId,
      salesOrderItemComponentId: row.salesOrderItemComponentId,
      description: row.description,
      kind: row.kind,
      qty: cur.qty,
      unit: row.unit,
      unitCost: row.unitCost,
      supplierId: cur.supplierId || null,
      quoteSupplierId: row.quoteSupplierId,
      sortOrder: row.sortOrder,
      lotDescription: row.lotDescription,
      confirmZero: cur.confirmZero,
      remainingQty: row.remainingQty,
    };
  });
  const plan = planPoSelection(selection);
  const fieldErrors = state.fieldErrors ?? {};
  const issueFor = (key: string, field: "supplier" | "qty" | "cost") =>
    fieldErrors[`${field}:${key}`] ?? plan.issues.find((issue) => issue.key === key && issue.field === field)?.message;
  const serverFailed = Boolean(state.message && !state.ok);
  const alertText = serverFailed ? state.message : plan.issues.length ? selectionIssueSummary(plan.issues, "review") : null;
  const payload = {
    date: header.date,
    expectedDate: header.expectedDate,
    deliveryAddressText: header.deliveryAddressText,
    idempotencyKey: "",
    rows: selection.map((row) => ({
      key: row.key,
      supplierId: row.supplierId ?? "",
      qty: row.qty,
      confirmZero: !!row.confirmZero,
    })),
  };

  const setRow = (key: string, patch: Partial<RowState>) => setDraft((prev) => ({ ...prev, [key]: { ...(prev[key] ?? initialRow(rows.find((r) => r.key === key)!)), ...patch } }));

  const supplierChoices = (row: OpenRow, selected: string) => {
    const list = [...suppliers];
    const ensure = (id: string, name: string) => {
      if (id && !list.some((s) => s.id === id)) list.push({ id, name });
    };
    if (row.quoteSupplierId && !suppliers.some((s) => s.id === row.quoteSupplierId)) {
      ensure(row.quoteSupplierId, `${row.quoteSupplierName ?? "Current supplier"} (inactive)`);
    }
    if (selected && !list.some((s) => s.id === selected)) ensure(selected, names.get(selected) ?? "Selected supplier");
    return list;
  };

  const renderRow = (row: OpenRow, component: boolean) => {
    const cur = draft[row.key] ?? initialRow(row);
    const supplierError = issueFor(row.key, "supplier");
    const qtyError = issueFor(row.key, "qty");
    const costError = issueFor(row.key, "cost");
    const changed = !!cur.supplierId && !!row.quoteSupplierId && cur.supplierId !== row.quoteSupplierId;
    const wasNone = !row.quoteSupplierId && !!cur.supplierId;
    const zero = isZeroCost(row.unitCost);
    const total = row.locked ? null : lineTotal(cur.qty, row.unitCost);
    const orderedSome = toScaled(row.orderedQty || "0", 2) > 0n;
    return (
      <tr key={row.key} className={`${component ? "component" : ""}${row.locked ? " inactive" : ""}`.trim()}>
        <td className="col-check" data-label="">
          <input
            type="checkbox"
            checked={!row.locked && cur.checked}
            disabled={row.locked}
            aria-label={`Include ${row.description}`}
            onChange={(ev) => setRow(row.key, { checked: ev.target.checked })}
          />
        </td>
        <td className="desc desc-cell" data-label="Description">
          <div className="title">{row.description}</div>
        </td>
        <td data-label="Already on PO">
          {orderedSome ? (
            <span className="already-on">
              {showQty(row.orderedQty)} of {showQty(row.soQty)} on{" "}
              <Link href={`/purchase-orders/${row.purchaseOrders[0]!.id}`}>{row.purchaseOrders[0]!.number}</Link>
              {row.purchaseOrders.length > 1 ? ` +${row.purchaseOrders.length - 1} more` : ""}
            </span>
          ) : (
            <span className="faint small">—</span>
          )}
        </td>
        <td className="num qty-cell" data-label="Qty to order">
          {row.locked ? (
            "—"
          ) : (
            <>
              <input
                className={`row-qty${qtyError ? " has-error" : ""}`}
                type="text"
                inputMode="decimal"
                aria-label={`Qty ${row.description}`}
                value={cur.qty}
                onChange={(ev) => setRow(row.key, { qty: ev.target.value })}
              />
              <div className="hint">
                max {showQty(row.remainingQty)}
                {orderedSome ? " left" : ""} · {row.unit}
              </div>
              {qtyError && <div className="row-error">{qtyError}</div>}
            </>
          )}
        </td>
        <td className="supplier-cell" data-label="Supplier">
          {row.locked ? (
            row.quoteSupplierName ?? "—"
          ) : (
            <>
              <select
                className={`row-select${supplierError ? " has-error" : ""}`}
                aria-label={`Supplier ${row.description}`}
                aria-invalid={supplierError ? true : undefined}
                value={cur.supplierId}
                onChange={(ev) => setRow(row.key, { supplierId: ev.target.value })}
              >
                {!row.quoteSupplierId && <option value="">Select supplier…</option>}
                {supplierChoices(row, cur.supplierId).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              {changed && <span className="changed-hint">changed from {row.quoteSupplierName ?? "the quote supplier"}</span>}
              {wasNone && <span className="changed-hint">was: no supplier</span>}
              {changed && <span className="cost-hint">cost stays {formatPeso(row.unitCost)} (quote)</span>}
              {supplierError && <div className="row-error">{supplierError}</div>}
            </>
          )}
        </td>
        <td className="num cost-cell" data-label="Unit cost">
          {row.locked || !zero ? (
            <>
              {formatPeso(row.unitCost)}
              {!row.locked && <div className="cost-hint">from quote</div>}
            </>
          ) : (
            <div className="zero-block">
              <span>{formatPeso(row.unitCost)}</span>
              {cur.checked && <span className="chip amber">No cost yet</span>}
              <label className="confirm-zero">
                <input type="checkbox" checked={cur.confirmZero} onChange={(ev) => setRow(row.key, { confirmZero: ev.target.checked })} /> Confirm ₱0.00 cost
              </label>
              <span className="cost-hint">fix cost later in the draft PO</span>
              {costError && <div className="row-error">{costError}</div>}
            </div>
          )}
        </td>
        <td className="num strong" data-label="Line total">
          {row.locked ? <Chip>Fully ordered</Chip> : total ? formatPeso(total) : "—"}
        </td>
      </tr>
    );
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    if (step !== "review") {
      event.preventDefault();
      if (!plan.issues.length && plan.pos.length) setStep("review");
      return;
    }
    if (!idempotencyKey.current) idempotencyKey.current = crypto.randomUUID();
    const field = event.currentTarget.querySelector<HTMLInputElement>('input[name="payload"]');
    if (field) {
      const body = JSON.parse(field.value) as { idempotencyKey?: string };
      body.idempotencyKey = idempotencyKey.current;
      field.value = JSON.stringify(body);
    }
    onSubmit(event);
  };

  return (
    <form className="create-pos" onSubmit={submit} noValidate>
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />
      {step === "select" ? (
        <PageHeader
          title={`Create POs · ${soNumber}`}
          subtitle={`${customerName}. Tick items to order · supplier from quote (changeable) · costs stay as quoted · drafts only.`}
          actions={
            <Link className="btn btn-secondary" href={cancelHref}>
              Back to sales order
            </Link>
          }
        />
      ) : (
        <PageHeader
          title={`Review draft POs · ${soNumber}`}
          subtitle="Grouped by the suppliers you chose. POs are created as drafts — fix unit costs in each draft PO editor afterwards. Nothing written back to the SO/quote."
          actions={
            <button type="button" className="btn btn-secondary" onClick={() => setStep("select")}>
              ← Back to selection
            </button>
          }
        />
      )}

      {step === "review" ? (
        <>
          <p className="review-note">
            {plan.pos.length} draft PO{plan.pos.length === 1 ? "" : "s"} will be created in one atomic submit (all or none). Chosen suppliers are stored in the creation audit snapshot.
          </p>
          {plan.pos.map((po, n) => {
            const sum = pesoSum(po.lines);
            return (
              <div className="card" key={po.supplierId}>
                <div className="card-head">
                  <h2>
                    PO {n + 1} · {names.get(po.supplierId) ?? "Supplier"}
                  </h2>
                  <div className="right small muted">
                    {po.lines.length} line{po.lines.length === 1 ? "" : "s"} · <b>{formatPeso(sum)}</b>
                  </div>
                </div>
                <ul className="po-lines">
                  {po.lines.map((line) => {
                    const row = rows.find((r) => r.key === line.key);
                    const changed = !!row?.quoteSupplierId && row.quoteSupplierId !== po.supplierId;
                    const wasNone = row ? !row.quoteSupplierId : false;
                    const zero = isZeroCost(line.unitCost);
                    const orderedSome = row ? toScaled(row.orderedQty || "0", 2) > 0n : false;
                    return (
                      <li key={line.key}>
                        <div>
                          <div>
                            {line.description} {line.salesOrderItemComponentId ? <Chip>LOT component</Chip> : null}
                          </div>
                          <div className="line-meta">
                            {showQty(line.qty)} {line.unit}
                            {orderedSome ? " (remainder)" : ""} · unit cost {formatPeso(line.unitCost)} {zero ? "(confirmed)" : "(from quote)"}
                            {line.lotDescription ? ` · from ${line.lotDescription}` : ""}
                            {wasNone ? " · was: no supplier" : ""}
                          </div>
                          {changed && <div className="changed-hint">supplier changed from {row?.quoteSupplierName ?? "the quote supplier"}</div>}
                          {changed && <div className="cost-hint">cost kept from quote — edit in draft PO if needed</div>}
                          {zero && <div className="cost-hint">set the real unit cost in this draft PO after create</div>}
                        </div>
                        <div className="num strong">{formatPeso(lineTotal(line.qty, line.unitCost) ?? "0")}</div>
                      </li>
                    );
                  })}
                </ul>
                <div className="po-total">
                  <span className="muted">PO total</span>
                  <b className="num">{formatPeso(sum)}</b>
                </div>
              </div>
            );
          })}
          <div className="alert warn">Drafts only. After create, open each draft PO to adjust unit costs (or the header supplier). The sales order and quote are not updated.</div>
          <div className="form-actions">
            <button className="btn" type="submit" disabled={pending || plan.pos.length === 0}>
              {pending ? "Creating…" : `Create ${plan.pos.length} draft PO${plan.pos.length === 1 ? "" : "s"}`}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setStep("select")}>
              ← Back to selection
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="alert info">
            Supplier defaults to the quote/SO value and can be changed on any row. Cost does <b>not</b> follow a supplier change — fix unit costs inside each draft PO after create. Nothing is written back to the sales order or quote.
          </div>
          {alertText && (
            <div className="alert error" role="alert">
              {alertText}
            </div>
          )}
          <div className="card">
            <h2>For all new POs</h2>
            <div className="form-grid">
              <div className={`field${fieldErrors.date ? " has-error" : ""}`}>
                <label htmlFor="date">PO date</label>
                <input id="date" type="date" className="input" value={header.date} onChange={(ev) => setHeader({ ...header, date: ev.target.value })} />
                {fieldErrors.date && <div className="error">{fieldErrors.date}</div>}
              </div>
              <div className={`field${fieldErrors.expectedDate ? " has-error" : ""}`}>
                <label htmlFor="expectedDate">Expected delivery</label>
                <input id="expectedDate" type="date" className="input" value={header.expectedDate} onChange={(ev) => setHeader({ ...header, expectedDate: ev.target.value })} />
                {fieldErrors.expectedDate && <div className="error">{fieldErrors.expectedDate}</div>}
              </div>
              <div className="field full">
                <label htmlFor="deliveryAddressText">Deliver to</label>
                <textarea id="deliveryAddressText" rows={3} value={header.deliveryAddressText} onChange={(ev) => setHeader({ ...header, deliveryAddressText: ev.target.value })} />
                <div className="hint">From the sales order&apos;s delivery address. You can change it on each PO later.</div>
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-head">
              <h2>Items to order</h2>
              <div className="right small muted">
                {open.length} selectable{lockedCount ? ` · ${lockedCount} fully ordered` : ""}
              </div>
            </div>
            <div className="select-all-row">
              <label className="confirm-zero">
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={(ev) => {
                    const on = ev.target.checked;
                    setDraft((prev) => {
                      const next = { ...prev };
                      for (const row of open) next[row.key] = { ...(next[row.key] ?? initialRow(row)), checked: on };
                      return next;
                    });
                  }}
                />{" "}
                Select all open lines
              </label>
            </div>
            <div className="table-wrap">
              <table className="list">
                <thead>
                  <tr>
                    <th aria-label="Include" />
                    <th>Description</th>
                    <th>Already on PO</th>
                    <th className="num">Qty to order</th>
                    <th>Supplier</th>
                    <th className="num">Unit cost</th>
                    <th className="num">Line total</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) =>
                    line.isLot ? (
                      <Fragment key={line.id}>
                        <tr className="lot-header">
                          <td className="col-check" data-label="" />
                          <td colSpan={6} data-label="">
                            <Chip>LOT</Chip> {line.description} <span className="faint small">· components ordered separately</span>
                          </td>
                        </tr>
                        {(line.components ?? []).map((c) => renderRow(rows.find((r) => r.key === c.id)!, true))}
                      </Fragment>
                    ) : (
                      renderRow(rows.find((r) => r.key === line.id)!, false)
                    ),
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <div className="form-actions">
            <button
              className="btn"
              type="button"
              disabled={pending || plan.issues.length > 0 || checked.length === 0}
              onClick={() => {
                if (!plan.issues.length && plan.pos.length) setStep("review");
              }}
            >
              {plan.issues.length || !plan.pos.length ? "Review draft POs" : `Review ${plan.pos.length} draft PO${plan.pos.length === 1 ? "" : "s"}`}
            </button>
            <Link className="btn btn-secondary" href={cancelHref}>
              Cancel
            </Link>
            <span className="small muted">
              {plan.issues.length
                ? "Create stays disabled until every ticked ₱0 row is confirmed and every row has a supplier"
                : "Creates drafts only · supplier picks recorded in audit · no write-back to SO/quote"}
            </span>
          </div>
        </>
      )}
    </form>
  );
}
