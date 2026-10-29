// "Activity" section on record pages: audit rows for the record (and its contacts).

import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
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
};

export async function Activity({ targets }: { targets: { entityType: string; ids: string[] }[] }) {
  const rows = await db.auditLog.findMany({
    where: { OR: targets.filter((t) => t.ids.length).map((t) => ({ entityType: t.entityType, entityId: { in: t.ids } })) },
    include: { user: { select: { name: true } } },
    orderBy: { at: "desc" },
    take: 30,
  });
  return (
    <div className="card">
      <h2>Activity</h2>
      {rows.length === 0 ? (
        <div className="muted small">No activity yet.</div>
      ) : (
        <ul className="activity">
          {rows.map((r) => (
            <li key={r.id}>
              <div>
                <b>{r.user?.name ?? "System"}</b> {ACTION_LABELS[r.action] ?? r.action}{" "}
                {r.entityType === "Contact" ? "a contact" : ""}
              </div>
              <div className="when">{formatDateTime(r.at)}</div>
              {r.action === "update" && <DiffView before={r.before} after={r.after} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
