# Part 6 screenshots — supplier payments

Walkthrough as Admin/Approver: record ₱35,000 against two bills (WALK-INV-A full, WALK-INV-B partial), view, void, supplier tab, aging.

| File | Step |
|---|---|
| `01-payables-overview.png` | Payables home |
| `02-pick-supplier.png` | Pick supplier (open balances) |
| `03-form-full-balance-default.png` | Form: today + full balance auto-fill |
| `04-form-two-bills-partial.png` | ₱35k on two bills; Left to allocate ₱0 |
| `05-payment-detail-posted.png` | Detail, Posted at top; links to supplier + bills |
| `06-payment-allocations-tab.png` | Allocations tab (bill → PO links) |
| `07-supplier-payments-tab.png` | Supplier → Payments |
| `08-ap-aging.png` | AP aging after payment |
| `09-void-confirm-dialog.png` | Void confirm + required reason |
| `10-payment-voided.png` | Voided detail + audit |
| `11-ap-aging-after-void.png` | Aging restored after void |

## Usability before → after (self-review)

| Before | After |
|---|---|
| Cash paid blank; manual allocation guesswork | Defaults to total still owed; oldest bills auto-filled |
| Cryptic “Over by / Under by” | Running **Left to allocate** (green when ₱0.00); scaled-decimal math (no floats) |
| EWT columns always on | Hidden behind “Add withholding (EWT)” with plain-language hint |
| Labels: Method / Reference / Allocate | How you paid / Bank reference / Apply to unpaid bills |
| Flat empty lists | Empty states with a next-step button |
| Technical allocation errors | Actionable (“₱X still left to allocate…”) |
| Void link only | Confirm dialog with plain consequence + required reason |
| “Payments: later.” on PO bills | Bill ↔ payment ↔ supplier links (PO bills, payment detail, supplier tab) |
| Allocations to void/paid bills vague | Explicit block after row lock + concurrency test |
