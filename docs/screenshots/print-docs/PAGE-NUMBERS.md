# Page X of Y (CSS only)

Print documents keep a footer row (thank-you / terms on the left, spacer in the center, QR on the right). **Page numbers** are drawn in the page margin, not as in-flow generated text:

```css
@page {
  size: A4;
  margin: 18mm;
  @bottom-center {
    content: "Page " counter(page) " of " counter(pages);
  }
}
```

`.pp-page-num::after` stays empty (`content: none`). An in-flow `counter(pages)` there becomes **Page 0 of 0** under Chrome headless `--print-to-pdf`, even though the same counters work in `@page` margin boxes and in the browser print dialog.

Turn off browser headers & footers when printing (toolbar Print / Save PDF sets a clean document title like `SO-2026-0002`; headless uses `--no-pdf-header-footer`). No JavaScript or PDF library is used for page numbers.
