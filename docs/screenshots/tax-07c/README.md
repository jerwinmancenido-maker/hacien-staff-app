# HACIEN Tax Worksheets UI Screenshots - tax-07c

This directory contains screenshots from a staff walkthrough of the HACIEN tax worksheets UI, captured on October 30, 2026.

## Environment
- **App URL:** http://127.0.0.1:3000
- **Login:** jerwin@example.com
- **BOOKS_ENABLED:** On
- **Desktop Width:** ~1280px

## Screenshots

### 01-login.png
**Description:** Login page at `/login`  
**Shows:** Clean login form with email and password fields, "HACIEN Staff" branding, and "Sign in" button.

### 02-books-nav-tax.png
**Description:** After login, sidebar showing Books navigation  
**Shows:** Main dashboard with left sidebar navigation. The "Books" menu item is visible under the DEALS section, along with other navigation items (Home, Customers, Suppliers, Quotes, Sales Orders, etc.).

### 03-tax-overview-banner.png
**Description:** Tax worksheets overview at `/books/tax`  
**Shows:** Tax worksheets landing page with navigation tabs (Overview, 1701Q (8%), 2307s received, EWT withheld, Sales summary) and the **mandatory banner** displaying:

> **"Worksheet only — check with your accountant before filing. Not filed by this app."**

This page lists four worksheet options:
- Quarterly income tax worksheet (1701Q, 8% option)
- 2307s received from customers
- EWT withheld on supplier payments
- Sales summary by month

**Default period:** Q3 2026 (latest finished quarter)

### 04-income-1701q.png
**Description:** 1701Q quarterly income tax worksheet at `/books/tax/income`  
**Shows:** Line-by-line math for the 1701Q (8% option) worksheet with the following calculation rows:
- (a) Cumulative gross sales and receipts
- (b) Less allowance — for 8% option, sole proprietor
- (c) Taxable amount
- (d) Income tax (8%)
- (e) Less tax paid in earlier quarters this year
- (f) Less creditable withholding (customers' 2307s / collections EWT)
- (g) Payable or overpayment

**Includes:** Year (2026) and Quarter (Q3) filter dropdowns, Apply/Export CSV/Print buttons, and the **mandatory banner**.

**Sample data:** Shows ₱5,000.00 cumulative sales, ₱250,000.00 allowance, resulting in -₱1,500.00 overpayment.

### 05-2307s-received.png
**Description:** 2307s received from customers at `/books/tax/2307-received`  
**Shows:** Empty state for customer 2307s worksheet. Displays message "No 2307s this quarter" with instruction to "Record collections with EWT under Billing first."

**Includes:** Year/Quarter filters, summary showing "Totals: income ₱0.00 · tax withheld ₱0.00 · pending 0 · received 0", and the **mandatory banner**.

### 06-ewt-withheld.png
**Description:** EWT withheld on supplier payments at `/books/tax/ewt-withheld`  
**Shows:** Expanded Withholding Tax (EWT) worksheet with monthly and quarterly totals tables. All values show ₱0.00 (empty state).

**Critical element:** Displays the **RDO registration note**:
> **"Only applies if HACIEN is registered to withhold — confirm with RDO."**

**Includes:** Year/Quarter filters, monthly breakdown (2026-07, 2026-08, 2026-09), quarterly totals table (Q1-Q4 2026), and the **mandatory banner**.

### 07-sales-summary.png
**Description:** Sales summary by month at `/books/tax/sales-summary`  
**Shows:** Monthly sales breakdown for 2026. Lists all 12 months with gross sales billings and source information.

**Sample data:** 
- January-July: ₱0.00 (0 Sales register)
- **August: ₱5,000.00 (1 Sales register)**
- September-December: ₱0.00 (0 Sales register)
- **Year total: ₱5,000.00 (1 billing)**

**Note:** "Non-void billings by Invoice date (Manila). Never includes VAT."

**Includes:** Year (2026) filter dropdown and the **mandatory banner**.

### 08-income-print.png
**Description:** Print/PDF view of 1701Q worksheet at `/print/books/tax/income`  
**Shows:** Clean print-optimized layout of the quarterly income tax worksheet for Q3 2026. Designed for A4 paper format.

**Header information:**
- Entity: HACIEN
- Status: NON-VAT • 8% income tax option • TIN —
- Period: Q3 2026

**Includes:** Full line-by-line calculation table (same data as 04-income-1701q.png) and the **mandatory banner** displayed prominently at the top of the printable page.

**Actions:** "Back to worksheet" button and "Print / Save PDF" button in top navigation.

### 09-empty-or-filters.png
**Description:** Worksheet showing year/quarter filters at `/books/tax/income`  
**Shows:** The 1701Q income worksheet with filter controls clearly visible. Demonstrates the year/quarter selection interface used across all tax worksheets.

**Filter controls:**
- Year dropdown (set to 2026)
- Quarter dropdown (set to Q3 (Jul-Sep))
- Apply button
- Export CSV button
- Print / PDF button

**Status text:** "Showing the latest finished quarter (Q3 2026)."

**Includes:** Full worksheet data and the **mandatory banner**.

---

## Banner Text

The exact banner text that appears on all tax worksheet pages is:

> **"Worksheet only — check with your accountant before filing. Not filed by this app."**

This banner is visible and prominent in the following screenshots:
- 03-tax-overview-banner.png (overview page)
- 04-income-1701q.png (1701Q worksheet)
- 05-2307s-received.png (2307s received)
- 06-ewt-withheld.png (EWT withheld)
- 07-sales-summary.png (sales summary)
- 08-income-print.png (print view)
- 09-empty-or-filters.png (filters example)

## Additional Notes

- All screenshots use seed data from "Sample Corp" and similar test entities
- No real customer data was used
- The app correctly displays the non-VAT status throughout
- All worksheets default to Q3 2026 as the latest finished quarter
- The Books section is enabled and accessible via the left sidebar navigation
- User logged in: jerwin@example.com (Admin · Approver role)
