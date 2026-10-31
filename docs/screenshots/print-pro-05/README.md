# Print-pro-05 artifacts

Fake sample data only (TESDA / Sample Bank / TIN 000-000-000-00000).
Chrome headless `--print-to-pdf --no-pdf-header-footer` (real print layout), then `pdftoppm` → PNG.

| Artifact | Notes |
|---|---|
| quote-3-lines / quote-3-lines-after | Quotation, 3 lines A4 (after = latest layout) |
| quote-3-lines-letter | Quotation, 3 lines Letter (0.7in `@page`) |
| quote-3-lines-before | Earlier uneven-margin reference |
| quote-25-lines (+ p1/p2) | Quotation, 25 lines |
| sales-order | SO-2026-0002 |
| billing-statement | Billing statement (BIR wording unchanged) |
| quote-withholding | Est. WHT lines |
| letterhead-clearspace | Brand kit logo-full.svg at 45 mm with clear-space annotation |

Equal side margins: A4 `@page` 18mm, Letter `@page` 0.7in; content fills the printable width (|L−R| ≤ 1mm).
