import type { ReactNode } from "react";

/**
 * Print shell wrapper that puts the letterhead on EVERY printed page.
 *
 * The document body is wrapped in a one-column table whose <thead> holds
 * the header (the letterhead). Browsers repeat a table's thead at the top
 * of every printed page, so page 2, 3, … carry the same header as page 1 —
 * in normal flow, so body content always starts below it (no overlap).
 *
 * Why not position:fixed? Chrome anchors fixed print elements to the page
 * content box (top:0 = below the top margin), and a negative top that
 * would lift the header into the margin band makes Chrome drop it to the
 * bottom of the page instead (verified in headless Chrome renders,
 * 2026-11-07). The thead repeat is the mechanism that works.
 *
 * On screen the table is a transparent container (see .pp-repeat in
 * globals.css), so the print preview looks exactly as before.
 */
export function PrintHeaderRepeat({
  header,
  children,
}: {
  header: ReactNode;
  children: ReactNode;
}) {
  return (
    <table className="pp-repeat" role="presentation">
      <thead>
        <tr>
          <th className="pp-repeat-head">{header}</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td className="pp-repeat-body">{children}</td>
        </tr>
      </tbody>
    </table>
  );
}
