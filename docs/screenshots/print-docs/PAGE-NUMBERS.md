# Page X of Y (CSS only)

Print documents use `@page` margin boxes:

```css
@bottom-right {
  content: "Page " counter(page) " of " counter(pages);
}
```

- Engines that support `counter(pages)` show e.g. **Page 1 of 2**.
- If the total is blank (common in some browser print previews), the in-document `.pp-page-num` fallback shows **Page X** only (`counter(page)`).

No JavaScript or PDF library is used for page numbers.
