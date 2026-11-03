// Backups facts (Q14, S-47) — facts only, never claims.
// Source: HACIEN Ops Task Tracker, status as of Nov 3, 2026, 11:15 PM PHT.
// These are static, checked facts, not a live check of any backup system.
// Do not add a claim here unless it has been verified the same way.

/** When these facts were last checked, per the tracker. */
export const BACKUP_FACTS_AS_OF = "Nov 3, 2026";

export type BackupFact = {
  title: string;
  detail: string;
};

/** What is actually in place. */
export const BACKUP_FACTS: readonly BackupFact[] = [
  {
    title: "Manual staging database export before every deploy with a migration",
    detail:
      "The CTO takes a manual staging database export before every deploy that includes a migration. 6 such exports so far, Oct 31 to Nov 1, 11:56 PM PHT. They are kept on the CTO's box, owner-only, and are not off-site.",
  },
  {
    title: "Hostinger automatic backup is ON",
    detail:
      "Automatic backup is ON at the host, per the owner. Frequency, retention, and the latest backup date have not been checked.",
  },
];

/** What is NOT in place. Shown explicitly so the screen never implies it. */
export const BACKUP_NOT_IN_PLACE: readonly BackupFact[] = [
  {
    title: "No scheduled app backup",
    detail: "There is no scheduled backup run by the app itself.",
  },
  {
    title: "No off-site copy",
    detail: "There is no off-site copy of the backups listed above.",
  },
  {
    title: "No restore test",
    detail: "No restore from a backup has been tested.",
  },
];

/** Claims this screen must never make. Tests assert none of these appear. */
export const BACKUP_NEVER_CLAIM: readonly string[] = [
  "daily backup",
  "scheduled app backup",
  "off-site copy",
  "restore tested",
];
