/**
 * L25 Fix B — "Did you mean" customer-name suggestions (pure; no DB here).
 *
 * Fallback only: callers run this ONLY when an exact customer search already
 * came back empty, and the suggestions render as labelled links in the empty
 * state — never merged into results. Customer NAMES only: document numbers,
 * supplier names and contact names never fuzzy-match (a typo'd quote/SO/
 * billing number must never land on a different money document).
 *
 * Engine (spike: l25-search-spike.md §3 B3/B4): trigram prefilter +
 * Levenshtein confirm, token-wise against the candidate's name tokens.
 * A query token matches when its closest candidate token is within edit
 * distance 1 (tokens of ≤5 chars) or 2 (longer tokens); a candidate is
 * suggested only when EVERY query token matches. Best ≤3, ranked by total
 * distance, then name.
 */

export type CustomerNameCandidate = {
  id: string;
  name: string;
  /** `false` rows are never suggested (the DB fetch also filters active). */
  active?: boolean;
};

export type CustomerNameSuggestion = { id: string; name: string };

const MAX_SUGGESTIONS = 3;
const MIN_QUERY_CHARS = 3;

/**
 * Document-shaped queries: an optional short letter prefix (QT-, SO-…) plus
 * digits/dashes/spaces, or digits alone. These are numbers, not names, and
 * stay exact-only.
 */
const DOCUMENT_LIKE = /^([a-z]{1,4}[\s-]*)?\d[\d\s-]*$/i;

/** Name-like = worth suggesting on: ≥3 chars, has a letter, not document-shaped. */
export function isNameLikeCustomerQuery(q: string): boolean {
  const t = q.trim();
  return t.length >= MIN_QUERY_CHARS && /[a-z]/i.test(t) && !DOCUMENT_LIKE.test(t);
}

function tokensOf(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
}

function trigrams(token: string): Set<string> {
  const padded = `  ${token} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
  return out;
}

function sharesTrigram(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  for (const g of a) if (b.has(g)) return true;
  return false;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur.push(Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

function tokenThreshold(token: string): number {
  return token.length <= 5 ? 1 : 2;
}

export function rankCustomerNameSuggestions(
  q: string,
  candidates: readonly CustomerNameCandidate[],
): CustomerNameSuggestion[] {
  if (!isNameLikeCustomerQuery(q)) return [];
  const qTokens = tokensOf(q);
  if (qTokens.length === 0) return [];
  const qGrams = qTokens.map(trigrams);

  const scored: { id: string; name: string; score: number }[] = [];
  for (const c of candidates) {
    if (c.active === false) continue;
    const cTokens = tokensOf(c.name);
    if (cTokens.length === 0) continue;
    const cGrams = cTokens.map(trigrams);
    let total = 0;
    let ok = true;
    for (let i = 0; i < qTokens.length; i++) {
      let best = Infinity;
      for (let j = 0; j < cTokens.length; j++) {
        if (!sharesTrigram(qGrams[i]!, cGrams[j]!)) continue;
        const d = levenshtein(qTokens[i]!, cTokens[j]!);
        if (d < best) best = d;
      }
      if (best > tokenThreshold(qTokens[i]!)) {
        ok = false;
        break;
      }
      total += best;
    }
    if (ok) scored.push({ id: c.id, name: c.name, score: total });
  }

  scored.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
  return scored.slice(0, MAX_SUGGESTIONS).map(({ id, name }) => ({ id, name }));
}
