"use client";

import { useState } from "react";
import { formatDate, isoDate, manilaToday } from "@/lib/format";
import { QtyBar, qtyText } from "@/components/purchasing/PoParts";
import { NoIdUploadWarning } from "@/components/NoIdUploadWarning";
import { VoidButton } from "@/components/purchasing/DocButtons";
import { useFormAction } from "@/components/useFormAction";
import { FileInput } from "@/components/FileInput";
import { soDeliveryProgress, soPodIncomplete } from "@/lib/sales-orders/delivery";
import { formatBookletNumber, formatSerialDisplay } from "@/lib/billing/booklet";
import type { FormState } from "@/lib/validation/forms";

const day = (d: Date | string | null | undefined) => {
  if (!d) return "—";
  const str = typeof d === "string" ? d : d.toISOString().slice(0, 10);
  return formatDate(new Date(`${str.slice(0, 10)}T00:00:00.000Z`));
};

type DeliveryItemRow = {
  id: string;
  description: string;
  unit: string;
  qty: string;
  deliveredQty: string;
};

type DeliveryRecord = {
  id: string;
  drNumber: string;
  deliveryDate: Date | string;
  receivedBy: string | null;
  receivedDate: Date | string | null;
  idSightChecked: boolean;
  idCheckedBy?: { name: string } | null;
  idCheckedAt?: Date | string | null;
  voidedAt?: Date | string | null;
  voidReason?: string | null;
  notes?: string | null;
  items: {
    id: string;
    salesOrderItemId: string;
    qty: unknown;
    serialNumbers: string | null;
    salesOrderItem: { description: string; unit: string };
  }[];
  attachments: { id: string; fileName: string }[];
};

export function DeliverySection({
  nextDrNo,
  drSeriesFrom,
  drSeriesTo,
  status,
  items,
  deliveries,
  canEdit,
  canVoid,
  action,
  voidAction,
}: {
  nextDrNo?: number | null;
  drSeriesFrom?: number | null;
  drSeriesTo?: number | null;
  status: string;
  items: DeliveryItemRow[];
  deliveries: DeliveryRecord[];
  canEdit: boolean;
  canVoid: boolean;
  action: (state: FormState, form: FormData) => Promise<FormState>;
  voidAction: (deliveryId: string, reason: string) => Promise<FormState>;
}) {
  const [showForm, setShowForm] = useState(false);
  const [mode, setMode] = useState<"all" | "some">("all");
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [serials, setSerials] = useState<Record<string, string>>({});
  const [drNumber, setDrNumber] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const progress = soDeliveryProgress(items);
  const podIncomplete = soPodIncomplete(progress, deliveries);
  const todayYmd = isoDate(manilaToday());

  const { state, pending, onSubmit } = useFormAction(async (prev, form) => {
    const res = await action(prev, form);
    if (res.ok) {
      setShowForm(false);
      setQtys({});
    }
    return res;
  });

  const remaining = (ordered: string, delivered: string) => {
    const r = Math.max(0, Number(ordered) - Number(delivered));
    return Number.isInteger(r) ? String(r) : r.toFixed(2);
  };

  const remainingMap = () => {
    const next: Record<string, string> = {};
    for (const item of items) {
      const rem = remaining(item.qty, item.deliveredQty);
      if (Number(rem) > 0) next[item.id] = rem;
    }
    return next;
  };

  const fillAllRemaining = () => {
    setQtys(remainingMap());
  };

  const openForm = () => {
    setMode("all");
    setQtys(remainingMap());
    setDrNumber(nextDrNo != null ? String(nextDrNo) : "");
    setDeliveryDate(todayYmd);
    setShowForm(true);
  };

  const chooseMode = (next: "all" | "some") => {
    setMode(next);
    if (next === "all") setQtys(remainingMap());
  };

  // Live summary math — reads the same qty state the form posts, so the
  // summary can never disagree with what will be submitted.
  const activeLines = items.filter((i) => Number(remaining(i.qty, i.deliveredQty)) > 0);
  const qtyOf = (id: string) => {
    const n = Number((qtys[id] ?? "").replace(/,/g, ""));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const chosenLines = activeLines.filter((i) => qtyOf(i.id) > 0);
  const totalPieces = activeLines.reduce((sum, i) => sum + qtyOf(i.id), 0);
  const stillAfter = activeLines.filter(
    (i) => Number(remaining(i.qty, i.deliveredQty)) - qtyOf(i.id) > 0.0001,
  ).length;
  const fmtPieces = (n: number) => String(Math.round(n * 100) / 100);
  const drDigits = drNumber.replace(/\D/g, "");
  const drLabel = drDigits ? formatBookletNumber(Number(drDigits)) : "—";
  const nothingChosen = totalPieces <= 0;

  const e = state.fieldErrors ?? {};

  return (
    <div className="card" aria-label="Deliveries">
      <div className="card-head">
        <h2>Deliveries</h2>
        <div className="right" style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <span className="small muted strong">{progress.label}</span>
          {podIncomplete && <span className="chip amber">POD incomplete</span>}
          {canEdit && status === "OPEN" && !showForm && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={openForm}
            >
              Add delivery
            </button>
          )}
        </div>
      </div>

      <div className="table-wrap items-table">
        <table className="list" aria-label="Delivery progress per item">
          <thead>
            <tr>
              <th>#</th>
              <th>Item</th>
              <th className="num">Ordered</th>
              <th className="num">Delivered</th>
              <th aria-label="Progress" />
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i, idx) => {
              const isDone = Number(i.deliveredQty) >= Number(i.qty) && Number(i.qty) > 0;
              const isPartial = Number(i.deliveredQty) > 0 && !isDone;
              return (
                <tr key={i.id}>
                  <td className="faint">{idx + 1}</td>
                  <td style={{ whiteSpace: "pre-wrap" }}>{i.description.split("\n")[0]}</td>
                  <td className="num">
                    {qtyText(i.qty)} {i.unit}
                  </td>
                  <td className="num">{qtyText(i.deliveredQty)}</td>
                  <td style={{ minWidth: 80 }}>
                    <QtyBar
                      received={i.deliveredQty}
                      ordered={i.qty}
                      label={`Delivered ${qtyText(i.deliveredQty)} of ${qtyText(i.qty)}`}
                    />
                  </td>
                  <td>
                    {isDone ? (
                      <span className="chip green">Fully delivered</span>
                    ) : isPartial ? (
                      <span className="chip amber">Partially delivered</span>
                    ) : (
                      <span className="chip faint">Not delivered</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showForm && (
        <form
          onSubmit={onSubmit}
          noValidate
          encType="multipart/form-data"
          style={{ marginTop: "24px", paddingTop: "16px", borderTop: "1px solid var(--border)" }}
        >
          <h3>Record delivery</h3>
          {state.message && (
            <div className={`alert ${state.ok ? "ok" : "error"}`} role="alert">
              {state.message}
            </div>
          )}

          <fieldset style={{ border: "none", padding: 0, margin: "0 0 16px" }}>
            <legend className="small strong" style={{ marginBottom: "8px" }}>
              What is going out in this delivery?
            </legend>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button
                type="button"
                className={mode === "all" ? "btn btn-sm" : "btn btn-secondary btn-sm"}
                aria-pressed={mode === "all"}
                onClick={() => chooseMode("all")}
              >
                Deliver everything that is left
              </button>
              <button
                type="button"
                className={mode === "some" ? "btn btn-sm" : "btn btn-secondary btn-sm"}
                aria-pressed={mode === "some"}
                onClick={() => chooseMode("some")}
              >
                Deliver only some items
              </button>
            </div>
          </fieldset>

          <div className="form-grid" style={{ marginBottom: "16px" }}>
            <div className={`field${e.drNumber ? " has-error" : ""}`}>
              <label htmlFor="drNumber">
                Pre-printed DR number<span className="req"> *</span>
              </label>
              <input
                id="drNumber"
                name="drNumber"
                type="text"
                className="input"
                placeholder="e.g. 10452"
                value={drNumber}
                onChange={(ev) => setDrNumber(ev.target.value)}
                required
              />
              {e.drNumber ? (
                <div className="error">{e.drNumber}</div>
              ) : drSeriesFrom != null && drSeriesTo != null ? (
                <div className="hint">
                  Booklet {formatBookletNumber(drSeriesFrom)}–{formatBookletNumber(drSeriesTo)}
                  {nextDrNo != null ? ` · next free: ${formatBookletNumber(nextDrNo)}` : ""}. Voided and spoiled numbers are never reused.
                </div>
              ) : null}
            </div>

            <div className={`field${e.deliveryDate ? " has-error" : ""}`}>
              <label htmlFor="deliveryDate">
                Delivery date<span className="req"> *</span>
              </label>
              <input
                id="deliveryDate"
                name="deliveryDate"
                type="date"
                className="input"
                value={deliveryDate}
                onChange={(ev) => setDeliveryDate(ev.target.value)}
                required
              />
              {e.deliveryDate && <div className="error">{e.deliveryDate}</div>}
            </div>

            <div className={`field${e.receivedBy ? " has-error" : ""}`}>
              <label htmlFor="receivedBy">Received by</label>
              <input
                id="receivedBy"
                name="receivedBy"
                type="text"
                className="input"
                placeholder="Client representative name"
              />
              {e.receivedBy && <div className="error">{e.receivedBy}</div>}
            </div>

            <div className={`field${e.receivedDate ? " has-error" : ""}`}>
              <label htmlFor="receivedDate">Date received</label>
              <input
                id="receivedDate"
                name="receivedDate"
                type="date"
                className="input"
              />
              {e.receivedDate && <div className="error">{e.receivedDate}</div>}
            </div>
          </div>

          <div className={`field${e.notes ? " has-error" : ""}`} style={{ marginBottom: "16px" }}>
            <label htmlFor="notes">Notes</label>
            <textarea id="notes" name="notes" className="input" rows={2} maxLength={2000} placeholder="Optional — gate instructions, partial-delivery remarks…" />
            {e.notes && <div className="error">{e.notes}</div>}
          </div>

          {mode === "all" ? (
            <div style={{ marginBottom: "16px" }}>
              <p style={{ margin: 0 }}>
                <strong>
                  All {activeLines.length} item{activeLines.length === 1 ? "" : "s"} will be delivered
                </strong>
                {activeLines.length > 0 && (
                  <>
                    {" — "}
                    {activeLines
                      .map(
                        (i) =>
                          `${qtyText(remaining(i.qty, i.deliveredQty))} ${i.unit} ${i.description.split("\n")[0]}`,
                      )
                      .join(" · ")}
                  </>
                )}
              </p>
              {/* Same payload as the grid posts: every item row, quantities = remaining. */}
              {items.map((i) => (
                <span key={i.id}>
                  <input type="hidden" name="itemId" value={i.id} />
                  <input type="hidden" name="itemQty" value={qtys[i.id] ?? ""} />
                  <input type="hidden" name="itemSerials" value={serials[i.id] ?? ""} />
                </span>
              ))}
            </div>
          ) : (
            <div style={{ marginBottom: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <h4>Items delivered</h4>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={fillAllRemaining}>
                    Fill in everything left
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setQtys({})}
                  >
                    Clear all
                  </button>
                </div>
              </div>
              <p className="hint" style={{ marginTop: 0 }}>
                Type how many of each item went out in this delivery. Leave 0 for items that did
                not go — you can deliver them later; nothing is lost.
              </p>
              <div className="table-wrap items-table">
                <table className="list" aria-label="Items delivered in this batch">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th className="num">Ordered</th>
                      <th className="num">Delivered</th>
                      <th className="num">Left to deliver</th>
                      <th className="num">Deliver now</th>
                      <th>Serial numbers</th>
                      <th aria-label="Row actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((i) => {
                      const rem = remaining(i.qty, i.deliveredQty);
                      const done = Number(rem) <= 0;
                      const err = e[`items.${i.id}`];
                      const over = !done && qtyOf(i.id) > Number(rem);
                      const notThisTime =
                        !done && (qtys[i.id] ?? "") !== "" && qtyOf(i.id) === 0;
                      return (
                        <tr
                          key={i.id}
                          className={done ? "inactive" : undefined}
                          style={notThisTime ? { opacity: 0.55 } : undefined}
                        >
                          <td>
                            {i.description.split("\n")[0]}
                            {notThisTime && (
                              <>
                                {" "}
                                <span className="chip faint">Not in this delivery</span>
                              </>
                            )}
                            {err && <div className="error small">{err}</div>}
                            {over && (
                              <div className="error small">Only {rem} left to deliver</div>
                            )}
                          </td>
                          <td className="num">
                            {qtyText(i.qty)} {i.unit}
                          </td>
                          <td className="num">{qtyText(i.deliveredQty)}</td>
                          <td className="num strong">{rem}</td>
                          <td className={`num${err || over ? " has-error" : ""}`}>
                            <input type="hidden" name="itemId" value={i.id} />
                            {/* readOnly (not disabled) so itemQty still posts and stays aligned with itemId */}
                            <input
                              name="itemQty"
                              type="text"
                              inputMode="decimal"
                              className="w-num-s input"
                              placeholder="0"
                              readOnly={done}
                              value={done ? "" : (qtys[i.id] ?? "")}
                              onChange={(ev) => setQtys({ ...qtys, [i.id]: ev.target.value })}
                            />
                          </td>
                          <td>
                            {/* readOnly (not disabled) so itemSerials stays aligned with itemId */}
                            <input
                              name="itemSerials"
                              type="text"
                              className="input"
                              placeholder="Comma-separated, if any"
                              readOnly={done}
                              value={done ? "" : (serials[i.id] ?? "")}
                              onChange={(ev) => setSerials({ ...serials, [i.id]: ev.target.value })}
                            />
                          </td>
                          <td>
                            {!done &&
                              (notThisTime ? (
                                <button
                                  type="button"
                                  className="btn-link small"
                                  onClick={() => setQtys({ ...qtys, [i.id]: rem })}
                                >
                                  Include it
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="btn-link small"
                                  onClick={() => setQtys({ ...qtys, [i.id]: "0" })}
                                >
                                  Not this time
                                </button>
                              ))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="form-grid" style={{ marginBottom: "16px" }}>
            <div className="field full">
              <label style={{ display: "inline-flex", alignItems: "center", gap: "8px", cursor: "pointer", fontWeight: "normal" }}>
                <input type="checkbox" name="idSightChecked" value="true" />
                <span>ID sight-checked (not copied)</span>
              </label>
              <div className="hint" style={{ marginTop: "4px" }}>
                Verify government or company ID visually. Do not photocopy or record ID numbers.
              </div>
            </div>

            <div className={`field full${e.files ? " has-error" : ""}`}>
              <label htmlFor="files">Signed copy upload</label>
              <FileInput
                id="files"
                name="files"
                multiple
                accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
              />
              <NoIdUploadWarning />
              {e.files ? (
                <div className="error">{e.files}</div>
              ) : (
                <div className="hint">Signed delivery receipt copy or scan. PDF, JPG or PNG.</div>
              )}
            </div>
          </div>

          {nothingChosen ? (
            <p className="small muted" role="status" style={{ marginBottom: "12px" }}>
              Nothing is in this delivery yet — type how many of each item went out, or switch to
              “Deliver everything that is left”.
            </p>
          ) : (
            <p className="small" role="status" style={{ marginBottom: "12px" }}>
              <strong>This delivery:</strong> {chosenLines.length} of {activeLines.length} items ·{" "}
              {fmtPieces(totalPieces)} pieces · DR {drLabel} · {day(deliveryDate)} — Still to
              deliver after this: {stillAfter} item{stillAfter === 1 ? "" : "s"}
            </p>
          )}

          <div className="form-actions">
            <button className="btn" type="submit" disabled={pending || nothingChosen}>
              {pending
                ? "Recording…"
                : mode === "all"
                  ? "Record delivery — everything that is left"
                  : "Record this delivery"}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setShowForm(false);
                setQtys({});
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {deliveries.length > 0 ? (
        <div style={{ marginTop: "20px" }}>
          <h3>Delivery records</h3>
          <div className="table-wrap items-table">
            <table className="list" aria-label="Delivery records">
              <thead>
                <tr>
                  <th>DR #</th>
                  <th>Date</th>
                  <th>Items delivered</th>
                  <th>Received by</th>
                  <th>Date received</th>
                  <th>ID check</th>
                  <th>Signed copy</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => (
                  <tr key={d.id} className={d.voidedAt ? "inactive" : undefined}>
                    <td className="strong">
                      {formatSerialDisplay(d.drNumber)}
                      {d.notes && <div className="faint" style={{ whiteSpace: "pre-wrap" }}>{d.notes}</div>}
                    </td>
                    <td>{day(d.deliveryDate)}</td>
                    <td>
                      <ul className="plain-list small">
                        {d.items.map((item) => (
                          <li key={item.id}>
                            {qtyText(String(item.qty))} {item.salesOrderItem.unit} · {item.salesOrderItem.description.split("\n")[0]}
                            {item.serialNumbers && <div className="faint">Serials: {item.serialNumbers}</div>}
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td>{d.receivedBy ?? "—"}</td>
                    <td>{day(d.receivedDate)}</td>
                    <td>
                      {d.idSightChecked ? (
                        <span className="chip small">
                          ID sight-checked (not copied)
                        </span>
                      ) : (
                        <span className="faint">—</span>
                      )}
                    </td>
                    <td>
                      {d.attachments.length === 0 ? (
                        <span className="faint">—</span>
                      ) : (
                        <ul className="plain-list small">
                          {d.attachments.map((a) => (
                            <li key={a.id}>
                              <a href={`/files/attachments/${a.id}`} target="_blank" rel="noreferrer">
                                {a.fileName}
                              </a>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="right">
                      {!d.voidedAt && (
                        <a className="btn-link small" href={`/print/deliveries/${d.id}/attachment`} target="_blank" rel="noreferrer">
                          Print attachment
                        </a>
                      )}{" "}
                      {d.voidedAt ? (
                        <span className="small muted">Void ({d.voidReason})</span>
                      ) : (
                        canVoid && (
                          <VoidButton
                            label="Void"
                            docLabel={`delivery receipt DR #${formatSerialDisplay(d.drNumber)}`}
                            body="Voiding this delivery reverses its delivered quantities."
                            onVoid={voidAction.bind(null, d.id)}
                          />
                        )
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <p className="faint">No deliveries yet.</p>
      )}
    </div>
  );
}
