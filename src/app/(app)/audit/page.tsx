import Link from "next/link";
import type { AuditAction, Prisma } from "@prisma/client";
import { requirePagePermission } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { formatDate, formatDateTime } from "@/lib/format";
import { DataTable } from "@/components/DataTable";
import { DiffView } from "@/components/DiffView";
import { Chip, EmptyState, PageHeader } from "@/components/ui";

const ACTIONS: AuditAction[] = ["create", "update", "archive", "restore", "void", "login", "login_failed", "settings_change"];
const ENTITIES = ["Customer", "Supplier", "Contact", "User", "Settings", "Session"];
const PAGE_SIZE = 50;

type Search = { entity?: string; action?: string; user?: string; page?: string };

function linkFor(entityType: string, entityId: string | null): string | undefined {
  if (!entityId) return undefined;
  switch (entityType) {
    case "Customer":
      return `/customers/${entityId}`;
    case "Supplier":
      return `/suppliers/${entityId}`;
    case "Contact":
      return `/contacts/${entityId}`;
    case "User":
      return `/settings/users/${entityId}`;
    case "Settings":
      return "/settings?tab=changelog";
  }
  return undefined;
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requirePagePermission("view_audit");
  const s = await searchParams;
  const page = Math.max(1, Number(s.page) || 1);
  const where: Prisma.AuditLogWhereInput = {
    ...(s.entity && ENTITIES.includes(s.entity) ? { entityType: s.entity } : {}),
    ...(s.action && (ACTIONS as string[]).includes(s.action) ? { action: s.action as AuditAction } : {}),
    ...(s.user ? { userId: s.user } : {}),
  };
  const [rows, total, users] = await Promise.all([
    db.auditLog.findMany({ where, include: { user: { select: { name: true } } }, orderBy: { at: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    db.auditLog.count({ where }),
    db.user.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageHref = (p: number) => {
    const q = new URLSearchParams(Object.entries({ ...s, page: String(p) }).filter(([, v]) => v) as [string, string][]);
    return `/audit?${q}`;
  };

  return (
    <>
      <PageHeader title="Audit log" subtitle="Every change, sign-in and settings save. Records are never deleted." />
      <form className="toolbar" action="/audit">
        <select name="entity" defaultValue={s.entity ?? ""} className="filter-chip" aria-label="Record type">
          <option value="">All records</option>
          {ENTITIES.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
        <select name="action" defaultValue={s.action ?? ""} className="filter-chip" aria-label="Action">
          <option value="">All actions</option>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <select name="user" defaultValue={s.user ?? ""} className="filter-chip" aria-label="User">
          <option value="">Everyone</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <button className="btn btn-secondary btn-sm" type="submit">
          Filter
        </button>
        <div className="right muted small">{total} entries</div>
      </form>
      {rows.length === 0 ? (
        <div className="card">
          <EmptyState line="No activity matches these filters." />
        </div>
      ) : (
        <DataTable
          label="Audit log"
          columns={[
            { key: "when", label: "When" },
            { key: "who", label: "Who" },
            { key: "action", label: "Action" },
            { key: "record", label: "Record" },
            { key: "change", label: "Change", sortable: false },
          ]}
          rows={rows.map((r) => ({
            id: r.id,
            href: linkFor(r.entityType, r.entityId),
            cells: {
              when: (
                <>
                  <div>{formatDate(r.at)}</div>
                  <div className="small muted">{formatDateTime(r.at).split(", ").pop()}</div>
                </>
              ),
              who: r.user?.name ?? <span className="faint">System</span>,
              action: <Chip tone={r.action === "login_failed" ? "red" : r.action === "archive" ? "amber" : r.action === "create" ? "green" : "grey"}>{r.action}</Chip>,
              record: (
                <>
                  <div>{r.entityType}</div>
                  <div className="small faint">{r.entityId}</div>
                </>
              ),
              change: <DiffView before={r.before} after={r.after} />,
            },
            sort: { when: r.at.getTime(), who: r.user?.name ?? "", action: r.action, record: r.entityType },
          }))}
        />
      )}
      {pages > 1 && (
        <div className="toolbar" style={{ marginTop: 12 }}>
          {page > 1 && (
            <Link className="btn btn-secondary btn-sm" href={pageHref(page - 1)}>
              ← Newer
            </Link>
          )}
          <span className="muted small">
            Page {page} of {pages}
          </span>
          {page < pages && (
            <Link className="btn btn-secondary btn-sm" href={pageHref(page + 1)}>
              Older →
            </Link>
          )}
        </div>
      )}
    </>
  );
}
