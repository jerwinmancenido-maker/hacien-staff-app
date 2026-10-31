# Design brief: HACIEN Staff App, clickable HTML mockup

Build a clickable mockup of the HACIEN Staff App, an internal tool for a small Philippine IT supplier that quotes, buys, delivers, bills and collects on government deals. Deliver ONE self-contained HTML file: inline CSS and JS, no external libraries, fonts or images, and it must open offline. Clicking the sidebar, rows, tabs, buttons and dropdowns should switch screens or open menus. No backend. All data is fake and hard-coded.

**Style:** follow the "Visual style" section at the end of this brief exactly. Jerwin will attach the reference image (a "Tasker" dashboard); match it.

**Button rules (apply everywhere):** each detail screen has ONE main button at the top right for the next step, with a "More ▾" dropdown beside it for everything else, including Print/PDF. Every list row has a "⋯" menu. Dangerous actions (Cancel, Void, Mark Lost) are red and ask for confirmation in a small modal.

**Screens:**
1. **Dashboard:** three cards at the top: Open deals (count + ₱ total), Cash gap (what we owe suppliers before buyers pay, with dates), and Overdue (customer bills past due). Below them is a short "Due today" list where each row has a ⋯ menu.
2. **Quotes list:** stage filter chips (All, Draft, For approval, Sent, Won, Lost, Expired) and a "New quote" main button. Columns: Quote no., Rev, Customer, Total, Margin %, Stage (colored chip), Valid until, ⋯ (Open, Print/PDF, Revise, Duplicate, Mark Lost in red).
3. **Quote view:** the header shows the quote no., Rev 1, customer, stage chip and valid-until date. The main button changes with the stage (e.g., Sent shows "Mark Won"). More ▾ holds Edit, Print/PDF, Revise, Duplicate and Mark Lost (red). The items table shows qty, supplier cost, HACIEN price and margin. Print/PDF opens a clean customer-facing print preview with costs and margin HIDDEN.
4. **Sales Order view:** the header shows the SO no., customer, buyer PO no. and an "Open" status. Show a progress row with four bars: Bought, Received, Delivered, Collected (%). Add a Cash gap line (supplier due date and amount vs. buyer due date and amount). The main button is the next step (e.g., "New delivery"), and More ▾ holds Print/PDF and Cancel SO (red). Three tabs (tracks): **Purchasing** (supplier POs, receiving, supplier payments), **Billing** (billing requests, collections, tax withheld, 2307), and **Delivery** (delivery receipts, acceptance). Each tab is a small table with ⋯ row menus.
5. **Settings:** horizontal tabs: Company, Users & roles, Approval rules, Numbering, Tax, Payment terms, Lists, Documents, Reminders, Bot, Accountant export. Each tab shows a simple form (e.g., Approval rules: margin threshold 18%, amount threshold ₱500,000, approver), a "Save changes" main button and a small change log.

**Sample data (show a small "Sample data" badge in the top bar):**
- Quote Q-2026-0012 Rev 1, customer **TESDA** (Government), contact Ana (Procurement), stage Sent, valid until Nov 28, 2026.
- Item: Laptop i5, qty 10, supplier **UNO** at ₱45,000/unit, HACIEN price ₱52,000/unit, less a ₱10,000 discount. Total ₱510,000, cost ₱450,000, margin ₱60,000 (11.8%).
- SO-2026-0001 from TESDA PO 2026-118: Bought 100%, Received 100%, Delivered 60%, Collected 0%. UNO payment of ₱450,000 due Nov 30; TESDA billing due Dec 15.
- Add 3–5 more fake quotes and SOs across the different stages so the lists look real.

Return only the single HTML file.


## Visual style (HACIEN brand kit v1.1)

Source of truth: brand kit style guide + logo handoff. Look: **black and white, one blue pixel.** Keep it clean — Jerwin dislikes boxy, cluttered layouts.

- **Overall:** Ink on white/grey. One accent blue used sparingly. Flat layout (no heavy app frame or drop shadow on the shell). Soft, generous whitespace.
- **Accent blue `#2563EB`:** used ONLY for the one primary button per screen, text links, and focus rings (plus the logo’s blue square and the 6px active-nav pixel). Never for big fills or body text. Hover/pressed: `#1D4ED8`. Selected/active tint: `#EFF6FF`.
- **Colors:** ink `#0A0A0A`; white `#FFFFFF`; page bg grey-50 `#FAFAFA`; fills/table header grey-100 `#F5F5F5`; rules/borders 1px grey-200 `#E5E5E5`; secondary text grey-600 `#525252`; labels/tagline grey-700 `#404040`; placeholder/disabled grey-400 `#A3A3A3`. Status chips only: success `#15803D` on `#F0FDF4`, warning `#B45309` on `#FFFBEB`, danger `#B91C1C` on `#FEF2F2`.
- **Logo (SVG only — never retype HACIEN in a font):**
  - Files: `logo-full.svg`, `logo-wordmark.svg`, `logo-full-white.svg`, `logo-mono-black.svg`, `icon.svg` / `icon-dark.svg`, PNGs, `favicon.ico` under `public/brand/`.
  - Clear space: **2× the blue square** (0.286 × cap height) empty on every side of the artwork.
  - Minimum sizes: full logo **200px / 40mm** wide; wordmark-only **96px / 24mm**; icon **16px / 6mm**. Below 200px use the wordmark; below 96px use the icon.
  - The blue square sits on the baseline, centred horizontally in the A (not vertically).
  - Staff app: `logo-wordmark.svg` at 24px tall in the sidebar; login uses centred `logo-full.svg` (≥200px). Favicon + app icons from the kit (`favicon.ico`, `icon-192` / `icon-512`, apple-touch).
- **Fonts:** Inter 400/500/600 for UI and body (`font-variant-numeric: tabular-nums` on amounts). **Archivo Black** for page titles only (and print document titles). Caps labels: Inter 600, 11–12px, uppercase, letter-spacing 0.08em, grey-700.
- **Shape:** radius 4px (inputs, chips), 6px (cards, buttons). No pill buttons. Shadows only on pop-overs and menus (`0 1px 2px rgba(0,0,0,.06), 0 4px 12px rgba(0,0,0,.06)`).
- **Sidebar:** white, 1px right border. Wordmark at top. Active nav: ink 600 text, blue-tint background, and a **6px blue square marker** on the left. Inactive: grey-600.
- **Top bar:** breadcrumb at left ("HACIEN / Staff / Page", last part bold). At right: search field, bell, avatar, sign out.
- **Page header:** optional grey greeting, Archivo Black title (~30px), grey subtitle. On the right: ONE primary blue button (and secondary/outline actions as needed).
- **Lists and tables:** white surface, grey-100 caps header, 1px grey-200 row dividers, ~44–56px rows, right-aligned tabular amounts. Whole row is a real link where applicable.
- **Buttons:** primary = blue `#2563EB` fill, white text, 6px radius, 36px tall (one per screen). Secondary = white + grey-200 border, ink text. Danger = white + danger text/border, always with a confirm.
- **Chips/tags:** 4px radius, status colours above (neutral = grey-700 on grey-100).
- **Spacing:** 4px grid; card padding 16–24px; generous whitespace. Pixel motif (6–8px blue square) at most one or two per screen (active nav, section bullet, empty-state accent).

### Tables and lists (modern SaaS list style, not Excel)

- **No grid:** no vertical lines and no cell borders. Use only a 1px `#E5E5E5` row divider, or none, and no divider under the last row.
- **Rows:** about 44–56px tall. On hover the row gets a soft grey-50 background with slight rounded ends (radius 6).
- **Clickable rows:** the whole row is clickable and opens that record (quote, SO, customer, etc.), not just the number text. Show a pointer cursor and the hover highlight. Clicks on the ⋯ menu, checkboxes, buttons and inputs must NOT open the row.
- **Header:** caps label style (Inter 600, ~11px, letter-spacing 0.08em, grey-700) on grey-100.
- **Primary column:** bold, with a muted secondary line under it (e.g. customer name with the buyer PO no. below, or quote no. with "Valid until" below). Customer and supplier cells get a small round initial avatar.
- **Cells:** status is shown as soft chips (4px radius) in the status colours. Amounts are right-aligned in tabular numbers, key amounts semi-bold. Progress is shown as mini inline bars.
- **⋯ menu:** a light icon with no border, faint until the row is hovered. Menu panel uses the overlay shadow.
- **Wide tables:** fold less important columns into the secondary line (e.g. Buyer PO under Customer, Next step under SO no., Due under Billing, Email under Name).
- **Toolbar above lists:** a search field, filter chips (the active chip is ink with white text) and a "View all" control on the right.
- **Empty states:** friendly, with a small round icon, "All clear here" and one helpful line. Never a bare "No data".
- **Finance tables:** the Books App view uses this modern style. ONLY "Copy to manual books" keeps the ledger-paper look (gridlines, page total, balance forward), because it mirrors the paper BIR book.
