"use client";

import { useRouter } from "next/navigation";

/** Account / date filters for the cash ledger. Changing account navigates immediately. */
export function LedgerFilters({
  accounts,
  accountId,
  from,
  to,
}: {
  accounts: { id: string; name: string; active: boolean }[];
  accountId: string;
  from: string | null;
  to: string | null;
}) {
  const router = useRouter();
  const build = (next: { accountId?: string; from?: string; to?: string }) => {
    const params = new URLSearchParams();
    params.set("accountId", next.accountId ?? accountId);
    const f = next.from ?? from ?? "";
    const t = next.to ?? to ?? "";
    if (f) params.set("from", f);
    if (t) params.set("to", t);
    return `/cash/ledger?${params.toString()}`;
  };

  return (
    <form
      className="filters"
      method="get"
      style={{ marginBottom: 16, flexWrap: "wrap", gap: 8, display: "flex", alignItems: "center" }}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        router.push(
          build({
            accountId: String(fd.get("accountId") ?? accountId),
            from: String(fd.get("from") ?? ""),
            to: String(fd.get("to") ?? ""),
          }),
        );
      }}
    >
      <label className="small">
        Account{" "}
        <select
          name="accountId"
          defaultValue={accountId}
          onChange={(e) => {
            router.push(build({ accountId: e.target.value }));
          }}
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {!a.active ? " (inactive)" : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="small">
        From <input type="date" name="from" defaultValue={from ?? ""} />
      </label>
      <label className="small">
        To <input type="date" name="to" defaultValue={to ?? ""} />
      </label>
      <button className="btn btn-secondary" type="submit">
        Apply dates
      </button>
      <a
        className="btn btn-secondary"
        href={`/cash/ledger/export?accountId=${accountId}${from ? `&from=${from}` : ""}${to ? `&to=${to}` : ""}`}
      >
        Export CSV
      </a>
    </form>
  );
}
