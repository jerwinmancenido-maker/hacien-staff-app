// "Activity" section on record pages: audit rows for the record (and its contacts).

import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { stripCosts, type PermissionUser } from "@/lib/permissions";
import { DiffView } from "./DiffView";

const ACTION_LABELS: Record<string, string> = {
  create: "created",
  update: "updated",
  archive: "marked inactive",
  restore: "made active",
  void: "voided",
  login: "signed in",
  login_failed: "failed sign-in",
  settings_change: "changed settings",
  email_draft: "drafted an email",
};

const ENTITY_LABELS: Record<string, string> = { Contact: "a contact", Quote: "the quote", SalesOrder: "the sales order" };

/**
 * `viewer`: pass on pages whose audit rows can hold costs (quotes, sales
 * orders); cost fields are then removed for users without "Can see costs".
 */
export async function Activity({
  targets,
  title = "Activity",
  viewer,
}: {
  targets: { entityType: string; ids: string[] }[];
  title?: string;
  viewer?: PermissionUser;
}) {
  const validTargets = targets.filter((t) => t.ids.length);
  const rows = validTargets.length
    ? await db.auditLog.findMany({
        where: { OR: validTargets.map((t) => ({ entityType: t.entityType, entityId: { in: t.ids } })) },
        include: { user: { select: { name: true } } },
        orderBy: { at: "desc" },
        take: 30,
      })
    : [];
  return (
    <div className="card activity-card">
      <h2>{title}</h2>
      {rows.length === 0 ? (
        <div className="muted small">No activity yet.</div>
      ) : (
        <div className="activity-timeline">
          {rows.map((r, i) => (
            <div key={r.id} className="activity-timeline-item">
              <div className="timeline-node">
                <span className="timeline-dot" aria-hidden />
                {i < rows.length - 1 && <span className="timeline-line" aria-hidden />}
              </div>
              <div className="timeline-content">
                <div className="timeline-heading">
                  <b>{r.user?.name ?? "System"}</b> {ACTION_LABELS[r.action] ?? r.action}{" "}
                  {ENTITY_LABELS[r.entityType] && targets.length > 1
                    ? ENTITY_LABELS[r.entityType]
                    : r.entityType === "Contact"
                      ? "a contact"
                      : ""}
                </div>
                <div className="timeline-when">{formatDateTime(r.at)}</div>
                {(r.action === "update" || r.action === "void") &&
                  (viewer ? (
                    <DiffView before={stripCosts(r.before, viewer)} after={stripCosts(r.after, viewer)} />
                  ) : (
                    <DiffView before={r.before} after={r.after} />
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
