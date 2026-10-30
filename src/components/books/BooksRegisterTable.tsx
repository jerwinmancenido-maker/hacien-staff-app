import Link from "next/link";
import { formatDate, formatPeso } from "@/lib/format";
import type { RegisterConfig } from "@/lib/books/config";
import { SOURCE_LABELS, type BookRegister } from "@/lib/books/registers";
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
                        <Link href={r.href}>{r.documentNumber}</Link>
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
            <tr>
              {config.columns.map((c) => {
                if (c.key === "amount") {
                  return (
                    <td key={c.key} className="num strong">
                      {formatPeso(register.periodAmountTotal)}
                    </td>
                  );
                }
                if (c.key === "ewt") {
                  return (
                    <td key={c.key} className="num strong">
                      {formatPeso(register.periodEwtTotal)}
                    </td>
                  );
                }
                if (c.key === "particulars") {
                  return (
                    <td key={c.key} className="strong">
                      Period total
                    </td>
                  );
                }
                return <td key={c.key} />;
              })}
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="faint small" style={{ marginTop: 12 }}>
        {register.rowCount} row{register.rowCount === 1 ? "" : "s"} · voided records are left out · each document no. opens the source record
        {hasEwt ? " · EWT is expanded withholding tax where recorded" : ""}.
      </p>
    </>
  );
}
