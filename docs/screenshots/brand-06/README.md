# Brand-06 — HACIEN restyle (visual layer)

Before/after screenshots of the staff app after applying brand kit v1.1 (Ink `#0A0A0A`, accent `#2563EB`, Inter + Archivo Black, official SVG logos).

- **Base:** `ef467d30` (main)
- **Widths:** 360px and 1280px
- **Data:** local throwaway MySQL seed only (`jerwin@example.com`)

| Screen | Files |
|---|---|
| Login (full logo) | `before/login-360.png`, `before/login-1280.png`, `after/…` |
| Home | `…/home-360.png`, `…/home-1280.png` |
| Customers list | `…/customers-list-*.png` |
| Customer detail | `…/customer-detail-*.png` |
| Sales order · Cost & margin | `…/sales-order-cost-margin-*.png` |
| Billing | `…/billing-*.png` |
| Tax calendar | `…/tax-calendar-*.png` |
| Settings | `…/settings-*.png` |

## After merging PR 20 (Home dashboard)

Merge of `origin/main` @ `f38e9dad` into `brand-06-hacien-restyle`. Home uses brand-06 tokens; sidebar Non-VAT meter drops `.00` on whole-peso limits.

| Screen | Files |
|---|---|
| Home (post-merge) | `home-after-pr20-merge-1280.png`, `home-after-pr20-merge-360.png` |
| Sidebar Non-VAT meter | `sidebar-nonvat-meter-1280.png`, `sidebar-nonvat-meter-360.png` |

## Product-owner follow-ups (post PR 20 merge)

Unboxed Home sections, collapsed mobile nav on every page, Payables tabs readable at 360, 2307 UI behind `PAYABLES_2307_ENABLED` (off by default).

| Screen | Files |
|---|---|
| Home | `home-po-fixes-1280.png`, `home-po-fixes-360.png` |
| Payables (PAYABLES_ENABLED=true, 2307 off) | `payables-po-fixes-1280.png`, `payables-po-fixes-360.png` |

## After merging PR 21 (withholding-from-customer)

| Screen | Files |
|---|---|
| Home | `home-after-pr21-1280.png`, `home-after-pr21-360.png` |
| Payables (2307 off) | `payables-after-pr21-1280.png`, `payables-after-pr21-360.png` |
| Payables 360 with `PAYABLES_2307_ENABLED=true` (tab scroll demo) | `payables-2307-on-360.png` |

