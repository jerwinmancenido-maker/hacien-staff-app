# Manual withholding picks (Brief 10) screenshots

Full-page PNG shots of the pick-based withholding UI and print (no WH on customer PDF).

| File | Viewport | Notes |
|---|---|---|
| `quote-editor-pick-1280.png` / `quote-editor-pick-360.png` | 1280 / 360 | Combined rates (Goods 1% + Gov 3%), mixed goods/services + internal panel |
| `quote-editor-not-set-1280.png` / `quote-editor-not-set-360.png` | 1280 / 360 | Quote with pick cleared — "Withholding not set…" notice |
| `quote-submit-confirm-none-1280.png` / `quote-submit-confirm-none-360.png` | 1280 / 360 | Submit confirm: Yes, none / Pick rates |
| `quote-add-customer-pick-1280.png` / `quote-add-customer-pick-360.png` | 1280 / 360 | Add-customer drawer with Withholding multi-select |
| `customer-overview-pick-1280.png` / `customer-overview-pick-360.png` | 1280 / 360 | Customer header chip shows saved pick (not type "No withholding") |
| `customer-edit-yes-1280.png` / `customer-edit-yes-360.png` | 1280 / 360 | Customer form: Yes → pick boxes visible |
| `customer-edit-no-1280.png` / `customer-edit-no-360.png` | 1280 / 360 | Customer form: No → boxes hidden, saves none |
| `quote-print-no-withholding-1280.png` | 1280 | Print: Subtotal + Total only; no WHT / ATC / Net amount due |

Heights and `scrollWidth` (360 must equal 360 — no page side-scroll) are in `shot-report.json`.

Scripts (local throwaway DB only, `ALLOW_SEED_SHOTS=1`):

- `scripts/manual-withholding-10-seed-shots.mjs`
- `scripts/manual-withholding-10-shots.mjs`
