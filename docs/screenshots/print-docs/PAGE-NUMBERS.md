# Page X of Y (CSS only)

Print documents use an in-document footer row (thank-you / terms on the left, page numbers centered, QR on the right):

```css
.pp-page-num::after {
  content: "Page " counter(page) " of " counter(pages);
}
```

`@page` sets A4 size and margins only (no `@top-*` / `@bottom-*` boxes), so Chrome does not draw its own date/title/URL header/footer into the margin area when headers & footers are off. Prefer Print / Save PDF from the screen toolbar (sets a clean document title like `SO-2026-0002`).

- Engines that support `counter(pages)` show e.g. **Page 1 of 2**.
- If the total is blank in some previews, the page counter still advances.

No JavaScript or PDF library is used for page numbers.
