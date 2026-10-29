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


## Visual style (match the attached reference image)

Jerwin will attach the reference image. Copy its look closely; only the content changes to HACIEN.

- **Overall:** monochrome. Black, white and warm greys only. No blue accent. The app sits in one big rounded frame (radius about 28px, soft drop shadow) on a light background.
- **Colors:** app background #F4F4F2; cards #FFFFFF; borders #E9E9E6 (1px); main text #151515; secondary text #6E6E6A; faint text #A3A3A0; fills #F0F0ED. Status colors stay but muted: green #3F7A57 on #EEF4EF, amber #94681E on #F8F3E8, red #A33A2F on #F7EDEB.
- **Font:** clean sans-serif (Inter or system). Page title about 24 to 28px, weight 600, slightly tight letter spacing. Body 13 to 14px. Labels 11 to 12px grey.
- **Sidebar (light, same color as background):** square black "H" logo plus "HACIEN". Nav items have a small grey line icon and a label. The active item is a white pill (radius 12, faint shadow) with bold black text. A small white card near the bottom (we use the ₱3M non-VAT limit tracker), then a user row: round avatar, "Jerwin", "Admin · Approver", ⋮.
- **Top bar:** breadcrumb at left ("HACIEN / Staff / Page", last part bold). At right: a rounded search pill with a "⌘K" hint, a bell icon and a round avatar.
- **Page header:** a small grey greeting ("Good evening, Jerwin 👋"), a big title, a grey subtitle. On the right: a white date-range pill ("📅 Oct 1 – Oct 31, 2026 ▾") and ONE black primary button (radius 12, white text, ⊕ icon).
- **Stat cards:** white, radius 16, soft border. Label top-left, small icon top-right, big number (about 22px), then a grey "↑ 12% vs last month" line and a tiny bar sparkline at bottom-right (thin grey bars, last few black).
- **Charts (Home):** bar chart for cash in vs out by week (black bars = in, light grey = out, legend dots at top-right, "Next 6 weeks ▾" pill). Donut for the deal pipeline (shades of black to light grey, total in the middle, legend list with counts and ₱ on the right). Timeline/Gantt for SO deliveries and payments: grey header row with week columns, one row per SO/PO, rounded grey pill bars with text, and a dashed vertical "Today" line with a black "Today" tag.
- **Lists and tables:** white card, light grey header row, thin row lines, ⋯ menu at row end. Small "View all" pill buttons at card top-right.
- **Buttons:** primary = black fill, radius 12. Secondary = white with border, fully round (pill). Dangerous = muted red, always with a confirm.
- **Chips/tags:** small rounded pills with the muted status colors above.
- **Spacing:** generous; 12 to 16px gaps between cards, 16 to 18px card padding. Soft, flat, no gradients except the donut.

### Tables and lists (modern SaaS list style, not Excel)

- **No grid:** no vertical lines and no cell borders. Use only a very faint row divider (#F3F3F0), or none, and no divider under the last row.
- **Rows:** about 56px tall. On hover the row gets a soft #F7F7F5 background with rounded ends (radius 12).
- **Clickable rows:** the whole row is clickable and opens that record (quote, SO, customer, etc.), not just the number text. Show a pointer cursor and the hover highlight. Clicks on the ⋯ menu, checkboxes, buttons and inputs must NOT open the row.
- **Header:** small uppercase text (about 10.5px), light grey, slight letter spacing, no background fill.
- **Primary column:** bold, with a muted secondary line under it (e.g. customer name with the buyer PO no. below, or quote no. with "Valid until" below). Customer and supplier cells get a small round initial avatar.
- **Cells:** status is shown as soft pill chips in the muted status colors. Amounts are right-aligned in tabular numbers, key amounts semi-bold. Progress is shown as mini inline bars.
- **⋯ menu:** a light icon with no border, faint until the row is hovered.
- **Wide tables:** fold less important columns into the secondary line (e.g. Buyer PO under Customer, Next step under SO no., Due under Billing, Email under Name).
- **Toolbar above lists:** a search pill, filter chips (the active chip is black with white text) and a "View all" pill on the right.
- **Empty states:** friendly, with a small round icon, "All clear here" and one helpful line. Never a bare "No data".
- **Finance tables:** the Books App view uses this modern style. ONLY "Copy to manual books" keeps the ledger-paper look (gridlines, page total, balance forward), because it mirrors the paper BIR book.
