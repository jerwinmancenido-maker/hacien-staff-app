import { requirePagePermission } from "@/lib/auth/current-user";
import { BACKUP_FACTS, BACKUP_FACTS_AS_OF, BACKUP_NOT_IN_PLACE } from "@/lib/backups/facts";
import { PageHeader } from "@/components/ui";

export default async function BackupsPage() {
  await requirePagePermission("manage_settings");

  return (
    <>
      <PageHeader
        title="Backups"
        subtitle="Facts only — what is actually backed up, and what is not claimed."
      />
      <div className="card">
        <p style={{ marginTop: 0 }}>
          This page is not a live backup check. It lists only the backup facts verified in the
          HACIEN Ops Task Tracker, as of {BACKUP_FACTS_AS_OF}. If a migration deploy has happened
          since then, the manual-export count below may be higher — do not assume it is current.
        </p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>What is in place</h2>
        <ul className="plain-list" style={{ paddingLeft: 18, marginBottom: 0 }}>
          {BACKUP_FACTS.map((fact) => (
            <li key={fact.title} style={{ marginBottom: 12 }}>
              <b>{fact.title}</b>
              <div className="faint small">{fact.detail}</div>
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>What is not in place</h2>
        <ul className="plain-list" style={{ paddingLeft: 18, marginBottom: 0 }}>
          {BACKUP_NOT_IN_PLACE.map((fact) => (
            <li key={fact.title} style={{ marginBottom: 12 }}>
              <b>{fact.title}</b>
              <div className="faint small">{fact.detail}</div>
            </li>
          ))}
        </ul>
        <p className="faint small" style={{ marginBottom: 0 }}>
          In particular, this page does not claim daily backups, a scheduled app backup, an
          off-site copy, or a tested restore.
        </p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Not checked</h2>
        <p style={{ marginBottom: 0 }}>
          Hostinger automatic backup frequency, retention, and latest backup date have not been
          checked.
        </p>
      </div>
    </>
  );
}
