import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser, requirePagePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { formatDate, formatPeso } from "@/lib/format";
import { getStatement } from "@/lib/billing/views";
import { AGING_BUCKET_LABELS, AGING_BUCKETS } from "@/lib/billing/aging";
import { COLLECTION_METHOD_LABELS } from "@/lib/validation/billing";
import { PrintButton } from "@/components/docs/PrintButton";

export const dynamic = "force-dynamic";

const day = (ymd: string | null) => (ymd ? formatDate(new Date(`${ymd}T00:00:00.000Z`)) : "—");

export async function generateMetadata({ params }: { params: Promise<{ customerId: string }> }): Promise<Metadata> {
  const { customerId } = await params;
  const user = await getCurrentUser();
  if (!user) return { title: "Statement" };
  const doc = await getStatement(customerId);
  return { title: doc ? `Statement ${doc.customer.name}` : "Statement" };
}

export default async function PrintStatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ customerId: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const user = await requirePagePermission("view");
  const { customerId } = await params;
  const sp = await searchParams;
  const from = sp.from ? new Date(`${sp.from}T00:00:00.000Z`) : null;
  const to = sp.to ? new Date(`${sp.to}T00:00:00.000Z`) : null;
  const doc = await getStatement(customerId, from, to);
  if (!doc) notFound();
  const missing = [!doc.company.name && "name", !doc.company.tin && "TIN", !doc.company.address && "address"].filter(Boolean) as string[];

  return (
    <div className="print-shell">
      <div className="print-toolbar no-print">
        <Link className="btn btn-secondary" href={`/customers/${customerId}?tab=balances`}>
          Back
        </Link>
        <span className="small muted">A4 · Statement of account — not an official invoice.</span>
        <PrintButton />
      </div>
      {missing.length > 0 && (
        <div className="alert warn print-toolbar-alert no-print" role="status">
          <b>HACIEN&apos;s {missing.join(" and ")} {missing.length > 1 ? "are" : "is"} blank in Company settings.</b>{" "}
          {can(user, "manage_settings") ? <Link href="/settings?tab=company">Open Company settings</Link> : "Ask an admin to fill in Company settings."}
        </div>
      )}

      <article className="print-doc statement-doc">
        <header className="print-header">
          <div>
            <div className="print-brand">{doc.company.name || <span className="print-placeholder">HACIEN (company name missing)</span>}</div>
            <div className="small">
              NON-VAT · TIN {doc.company.tin || <span className="print-placeholder">—</span>}
            </div>
            <div className="small" style={{ whiteSpace: "pre-wrap" }}>
              {doc.company.address || <span className="print-placeholder">Address missing</span>}
            </div>
          </div>
          <div className="print-doc-title">
            <h1>Statement of account</h1>
            <div className="small muted">Not an official invoice</div>
            {(doc.from || doc.to) && (
              <div className="small">
                Period: {day(doc.from)} – {day(doc.to)}
              </div>
            )}
          </div>
        </header>

        <section className="print-party">
          <h2>Customer</h2>
          <div>
            <strong>{doc.customer.name}</strong>
          </div>
          {doc.customer.tin && <div className="small">TIN {doc.customer.tin}</div>}
          {doc.customer.address && (
            <div className="small" style={{ whiteSpace: "pre-wrap" }}>
              {doc.customer.address}
            </div>
          )}
        </section>

        <table className="print-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th className="num">Charges</th>
              <th className="num">Credits</th>
              <th className="num">Balance</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={4}>Opening balance</td>
              <td className="num">{formatPeso(doc.openingBalance)}</td>
            </tr>
            {doc.lines.map((line) =>
              line.kind === "billing" ? (
                <tr key={`b-${line.id}`}>
                  <td>{day(line.date)}</td>
                  <td>
                    Booklet invoice #{line.invoiceNo} · due {day(line.dueDate)}
                  </td>
                  <td className="num">{formatPeso(line.amount)}</td>
                  <td className="num">—</td>
                  <td className="num">{formatPeso(line.runningBalance)}</td>
                </tr>
              ) : (
                <tr key={`c-${line.id}`}>
                  <td>{day(line.date)}</td>
                  <td>
                    Collection · {COLLECTION_METHOD_LABELS[line.method as keyof typeof COLLECTION_METHOD_LABELS] ?? line.method}
                    {line.receiptNo ? ` · ${line.receiptNo}` : ""}
                    {Number(line.unapplied) > 0 ? ` · credit ${formatPeso(line.unapplied)}` : ""}
                    {Number(line.withholding) > 0 ? ` · 2307 ${formatPeso(line.withholding)}` : ""}
                  </td>
                  <td className="num">—</td>
                  <td className="num">{formatPeso((Number(line.cash) + Number(line.withholding) + Number(line.unapplied)).toFixed(2))}</td>
                  <td className="num">{formatPeso(line.runningBalance)}</td>
                </tr>
              ),
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4}>
                <strong>Closing balance</strong>
                {Number(doc.credit) > 0 ? ` · customer credit ${formatPeso(doc.credit)}` : ""}
              </td>
              <td className="num">
                <strong>{formatPeso(doc.closingBalance)}</strong>
              </td>
            </tr>
          </tfoot>
        </table>

        <section className="statement-aging">
          <h2>Aging</h2>
          <div className="aging-buckets-grid">
            {AGING_BUCKETS.map((b) => (
              <div key={b} className="aging-bucket">
                <div className="aging-dot-label">{AGING_BUCKET_LABELS[b]}</div>
                <div className="aging-amt num">{formatPeso(doc.aging[b])}</div>
              </div>
            ))}
          </div>
        </section>

        <footer className="print-footer">
          <p>{doc.disclaimer}</p>
        </footer>
      </article>
    </div>
  );
}
