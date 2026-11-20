/**
 * Finish-all Phase 2 #5: quote revision chain display.
 *
 * A chain is every quote that shares one `revisionChainId` (the id of the
 * chain's Rev 1 quote), plus that Rev 1 quote itself. Members are stamped
 * at copy time (see copyQuote); a revision whose quote was later deleted
 * leaves a GAP in the revision numbers, which must render as plain text
 * ("Rev 2 — deleted"), never as a dead link.
 */

export type RevisionChainMember = {
  id: string;
  number: string;
  revision: number;
  createdAt: Date;
};

export type RevisionChainEntry =
  | { kind: "quote"; id: string; number: string; revision: number; isCurrent: boolean }
  | { kind: "deleted"; revision: number };

/**
 * Build the display entries for one quote's revision chain.
 * Returns [] when there is nothing to link: a lone quote, or a chain of
 * one. Present members sort by revision, then creation order (two live
 * quotes can share a revision number when a revision was made from an
 * older member — both are real links). Missing numbers between the
 * lowest and highest present revision become "deleted" text entries.
 */
export function buildRevisionChain(currentId: string, members: RevisionChainMember[]): RevisionChainEntry[] {
  if (members.length < 2) return [];
  const sorted = [...members].sort((a, b) => a.revision - b.revision || a.createdAt.getTime() - b.createdAt.getTime());
  const present = new Set(sorted.map((m) => m.revision));
  const min = sorted[0]!.revision;
  const entries: RevisionChainEntry[] = [];
  let prevRevision: number | null = null;
  for (const m of sorted) {
    if (prevRevision !== null) {
      for (let r = prevRevision + 1; r < m.revision; r++) {
        if (!present.has(r)) entries.push({ kind: "deleted", revision: r });
      }
    }
    entries.push({ kind: "quote", id: m.id, number: m.number, revision: m.revision, isCurrent: m.id === currentId });
    prevRevision = m.revision;
  }
  // A deleted Rev 1 (the chain root itself) also leaves a gap at the start.
  if (min > 1) {
    const head: RevisionChainEntry[] = [];
    for (let r = 1; r < min; r++) head.push({ kind: "deleted", revision: r });
    return [...head, ...entries];
  }
  return entries;
}
