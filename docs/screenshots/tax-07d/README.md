# HACIEN Tax Calendar UI Screenshots — tax-07d

Staff walkthrough of the provisional Tax calendar (Part 7d), captured October 30, 2026.

## Environment
- **App URL:** http://127.0.0.1:3000
- **Login:** jerwin@example.com (Admin · Approver)
- **BOOKS_ENABLED:** On
- **Desktop width:** 1280px
- **Phone width:** 360px (`07-phone-360.png`)

## Screenshots

### 01-login.png
Login page at `/login`.

### 02-books-nav-calendar.png
After login: sidebar Deals → **Books** visible (gated by `BOOKS_ENABLED` + `view_books`).

### 03-calendar-provisional-banner.png
`/books/tax/calendar` (Next 90 days). Shows Books tabs including **Tax calendar**, the mandatory provisional banner, deadline table (form, description, period, due PHT, status, Applies?, worksheet link, Mark as done), and owner **Download .ics**.

Banner text (exact):

> **Provisional: built from documents on hand, not the BIR COR. Check with your accountant or RDO before relying on these dates.**

### 04-calendar-all-view.png
Same page with **All** selected (`?view=all`).

### 05-mark-as-done.png
**Mark as done** expanded: done date, optional note, reminder that it is a staff note only (not a filing), Save note / Cancel.

### 06-settings-tax-calendar.png
Owner settings at `/settings?tab=tax-calendar`: **COR uploaded and checked** toggle plus per-obligation on/off and due day/month fields (plain labels).

### 07-phone-360.png
360px-wide view of `/books/tax/calendar` showing the provisional banner and deadline rows.

## Notes
- Read-only calendar: the app never files, pays, or sends anything.
- Sample/seed data only — no real customer data in screenshots or `.ics`.
- 0605 annual registration fee is not listed (abolished).
- Weekend hint example: legal due date kept; “File by \<previous working day\> to be safe” shown underneath.
