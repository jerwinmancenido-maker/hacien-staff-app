// S-84: the audit log lives here now (Admin only via Settings), not in
// the sidebar. Rows read as plain sentences with record numbers/names
// and a link — never raw ids or raw field dumps. Records are never deleted.

import Link from "next/link";
import type { AuditAction, Prisma } from "@prisma/client";
import { requirePagePermission } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  AUDIT_ENTITIES,
  AUDIT_ENTITY_LABELS,
  auditDeleteLabel,
  auditRecordLink,
  auditSentence,
  resolveAuditLabels,
} from "@/lib/audit-log";
import { DataTable } from "@/components/DataTable";
import { EmptyState } from "@/components/ui";

const ACTIONS: AuditAction[] = ["create", "update", "archive", "restore", "void", "login", "login_failed", "settings_change", "email_draft", "download", "delete"];
const PAGE_SIZE = 50;

type Search = { entity?: string; action?: string; user?: string; from?: string; to?: string; page?: string };

function href(s: Search, patch: Partial<Search>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({ tab: "audit", ...s, ...patch })) if (v) q.set(k, v);
  return `/settings?${q}`;
}

export async function AuditLogTab({ search }: { search: Search }) {
  const viewer = await requirePagePermission("manage_settings");
  const page = Math.max(1, Number(search.page) || 1);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(search.from ?? "") ? search.from! : undefined;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(search.to ?? "") ? search.to! : undefined;
  const where: Prisma.AuditLogWhereInput = {
    ...(search.entity && (AUDIT_ENTITIES as readonly string[]).includes(search.entity) ? { entityType: search.entity } : {}),
    ...(search.action && (ACTIONS as string[]).includes(search.action) ? { action: search.action as AuditAction } : {}),
    ...(search.user ? { userId: search.user } : {}),
    ...(from || to
      ? {
          at: {
            ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
            // "to" is inclusive: the exclusive bound is set below (next day).
            ...(to ? { lt: new Date(`${to}T00:00:00.000Z`) } : {}),
          },
        }
      : {}),
  };
  // "to" is inclusive: use the next day as the exclusive upper bound.
  if (to) {
    const d = new Date(`${to}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    (where.at as { lt: Date }).lt = d;
  }
  const [rows, total, users] = await Promise.all([
    db.auditLog.findMany({ where, include: { user: { select: { name: true } } }, orderBy: { at: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    db.auditLog.count({ where }),
    db.user.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const labels = await resolveAuditLabels(rows);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <div className="card">
        <h2>Audit log</h2>
        <p className="small muted">Every change, sign-in and settings save. Records are never deleted.</p>
        <form className="toolbar" action="/settings">
          <input type="hidden" name="tab" value="audit" />
          <select name="entity" defaultValue={search.entity ?? ""} className="filter-chip" aria-label="Record type">
            <option value="">All records</option>
            {AUDIT_ENTITIES.map((e) => (
              <option key={e} value={e}>
                {AUDIT_ENTITY_LABELS[e] ?? e}
              </option>
            ))}
          </select>
          <select name="action" defaultValue={search.action ?? ""} className="filter-chip" aria-label="Action">
            <option value="">All actions</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <select name="user" defaultValue={search.user ?? ""} className="filter-chip" aria-label="Person">
            <option value="">Everyone</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <label className="small muted">
            From <input type="date" name="from" defaultValue={from ?? ""} />
          </label>
          <label className="small muted">
            To <input type="date" name="to" defaultValue={to ?? ""} />
          </label>
          <button className="btn btn-secondary btn-sm" type="submit">
            Filter
          </button>
          <div className="right muted small">{total} entries</div>
        </form>
      </div>
      {rows.length === 0 ? (
        <div className="card">
          <EmptyState line="No activity matches these filters." />
        </div>
      ) : (
        <>
          <DataTable
            label="Audit log"
            columns={[
              { key: "when", label: "When" },
              { key: "who", label: "Who" },
              { key: "record", label: "Record" },
              { key: "what", label: "What happened", sortable: false },
            ]}
            rows={rows.map((r) => {
              const label =
                (r.action === "delete" ? auditDeleteLabel(r.before) ?? auditDeleteLabel(r.after) : null) ??
                (r.entityId ? labels.get(`${r.entityType}:${r.entityId}`) ?? null : null);
              const link = auditRecordLink(r.entityType, r.entityId, r.action);
              return {
                id: r.id,
                href: link,
                cells: {
                  when: (
                    <>
                      <div>{formatDate(r.at)}</div>
                      <div className="small muted">{formatDateTime(r.at).split(", ").pop()}</div>
                    </>
                  ),
                  who: r.user?.name ?? <span className="faint">System</span>,
                  record: (
                    <>
                      <div>{AUDIT_ENTITY_LABELS[r.entityType] ?? r.entityType}</div>
                      <div className="small faint">{label ?? "—"}</div>
                    </>
                  ),
                  what: auditSentence(r, label, viewer),
                },
              };
            })}
          />
          <div className="card" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="small muted">
              Page {page} of {pages}
            </span>
            {page > 1 && (
              <Link className="btn btn-secondary btn-sm" href={href(search, { page: String(page - 1) })}>
                Previous
              </Link>
            )}
            {page < pages && (
              <Link className="btn btn-secondary btn-sm" href={href(search, { page: String(page + 1) })}>
                Next
              </Link>
            )}
          </div>
        </>
      )}
    </>
  );
}
