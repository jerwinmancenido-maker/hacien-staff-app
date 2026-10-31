import Link from "next/link";
import { formatDate, formatPeso } from "@/lib/format";
import type { RegisterConfig } from "@/lib/books/config";
import {
  COLLECTED_TOTAL_LABEL,
  INVOICED_TOTAL_LABEL,
  SOURCE_LABELS,
  type BookRegister,
} from "@/lib/books/registers";
import { EmptyState } from "@/components/ui";

const day = (ymdStr: string) => formatDate(new Date(`${ymdStr}T00:00:00.000Z`));

function cell(row: BookRegister["rows"][number], key: RegisterConfig["columns"][number]["key"]): string {
  switch (key) {
    case "date":
      return day(row.date);
    case "documentNumber":
      return row.documentNumber;
    case "party":
      return row.party;
    case "particulars":
      return row.particulars;
    case "amount":
      return formatPeso(row.amount);
    case "ewt":
      return row.ewt != null && row.ewt !== "" ? formatPeso(row.ewt) : "—";
    case "source":
      return SOURCE_LABELS[row.kind];
  }
}

function TotalRow({
  config,
  label,
  amount,
  ewt,
}: {
  config: RegisterConfig;
  label: string;
  amount: string;
  ewt: string;
}) {
  return (
    <tr>
      {config.columns.map((c) => {
        if (c.key === "amount") {
          return (
            <td key={c.key} className="num strong">
              {formatPeso(amount)}
            </td>
          );
        }
        if (c.key === "ewt") {
          return (
            <td key={c.key} className="num strong">
              {formatPeso(ewt)}
            </td>
          );
        }
        if (c.key === "particulars") {
          return (
            <td key={c.key} className="strong">
              {label}
            </td>
          );
        }
        return <td key={c.key} />;
      })}
    </tr>
  );
}

export function BooksRegisterTable({
  config,
  register,
}: {
  config: RegisterConfig;
  register: BookRegister;
}) {
  if (register.rowCount === 0) {
    return <EmptyState title="Nothing in this period" line={config.emptyFeeds} />;
  }

  const hasEwt = config.columns.some((c) => c.key === "ewt");
  const sales = register.salesPeriodTotals;

  return (
    <>
      <div className="table-wrap">
        <table className="list" aria-label={config.title}>
          <thead>
            <tr>
              {config.columns.map((c) => (
                <th key={c.key} className={c.align === "right" ? "num" : undefined}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {register.rows.map((r) => (
              <tr key={`${r.kind}-${r.id}`}>
                {config.columns.map((c) => {
                  const value = cell(r, c.key);
                  if (c.key === "documentNumber") {
                    return (
                      <td key={c.key}>
                        {r.href ? <Link href={r.href}>{r.documentNumber}</Link> : r.documentNumber}
                      </td>
                    );
                  }
                  return (
                    <td key={c.key} className={c.align === "right" ? "num" : undefined}>
                      {value}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            {sales ? (
              <>
                <TotalRow
                  config={config}
                  label={INVOICED_TOTAL_LABEL}
                  amount={sales.invoicedAmount}
                  ewt={sales.invoicedEwt}
                />
                <TotalRow
                  config={config}
                  label={COLLECTED_TOTAL_LABEL}
                  amount={sales.collectedAmount}
                  ewt={sales.collectedEwt}
                />
              </>
            ) : register.periodAmountTotal != null ? (
              <TotalRow
                config={config}
                label="Period total"
                amount={register.periodAmountTotal}
                ewt={register.periodEwtTotal ?? "0.00"}
              />
            ) : null}
          </tfoot>
        </table>
      </div>
      {sales && (
        <p className="faint small" style={{ marginTop: 8 }} role="note">
          Draft figures under the banner above — Invoiced and Collected are listed separately on purpose. Neither is a tax
          basis; confirm with accountant/RDO.
        </p>
      )}
      <p className="faint small" style={{ marginTop: 12 }}>
        {register.rowCount} row{register.rowCount === 1 ? "" : "s"} · voided records are left out · each document no. opens
        the source record
        {hasEwt ? " · EWT is expanded withholding tax where recorded" : ""}.
      </p>
    </>
  );
}
