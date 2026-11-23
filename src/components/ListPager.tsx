import Link from "next/link";

/**
 * The ONE pager for the big list pages (quotes, sales orders, billings,
 * dispatch) — findings 1041 + 1043. Before this component each list
 * rendered its own pager and they diverged (billings said "Previous" in a
 * space-between bar; the rest said "Prev"), and none offered a direct
 * page jump. Every list now renders this exact markup: the same
 * "Page X of Y · N <noun>" sentence (the noun names what the list counts), the same Prev/Next links, and the
 * same jump form.
 *
 * The jump is a plain GET form back to the list's own URL: the active
 * filters ride along as hidden fields (jumpParams) and the typed page
 * lands in ?page=, where the data layer parses it with parsePageParam
 * and clamps it via pagingWindow — a jump past the end lands on the
 * last page.
 *
 * Renders nothing when the list fits on one page.
 */
export type ListPagerProps = {
  page: number;
  totalPages: number;
  total: number;
  /** What the list counts, plural lower case — renders as "{total} {noun}". */
  noun: string;
  /** URL for a target page with the list's filters/sort preserved. */
  hrefFor: (page: number) => string;
  /** The list's own path — the jump form submits here with method="get". */
  jumpAction: string;
  /** Active filter params the jump form carries as hidden fields (page excluded). */
  jumpParams?: Record<string, string | undefined>;
};

export function ListPager({ page, totalPages, total, noun, hrefFor, jumpAction, jumpParams }: ListPagerProps) {
  if (totalPages <= 1) return null;
  const carried = Object.entries(jumpParams ?? {}).filter(([, v]) => v);
  return (
    <div className="toolbar" style={{ marginTop: 10 }}>
      <span className="small faint">
        Page {page} of {totalPages} · {total} {noun}
      </span>
      {page > 1 && (
        <Link className="btn btn-secondary" href={hrefFor(page - 1)}>
          Prev
        </Link>
      )}
      <form className="pager-jump" method="get" action={jumpAction}>
        {carried.map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <label className="small faint">
          Go to page
          <input
            className="input"
            type="number"
            name="page"
            min={1}
            max={totalPages}
            defaultValue={page}
            aria-label="Page number"
          />
        </label>
        <button className="btn btn-secondary" type="submit">
          Go
        </button>
      </form>
      {page < totalPages && (
        <Link className="btn btn-secondary" href={hrefFor(page + 1)}>
          Next
        </Link>
      )}
    </div>
  );
}
