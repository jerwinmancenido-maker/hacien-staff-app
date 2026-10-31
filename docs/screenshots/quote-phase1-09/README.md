# Quote Phase 1 (Brief 09) screenshots

Full-page PNG shots of the redesigned quote editor and print preview.

| File | Viewport | Notes |
|---|---|---|
| `quote-items-1280.png` / `quote-items-360.png` | 1280 / 360 | Items tab |
| `quote-terms-1280.png` / `quote-terms-360.png` | 1280 / 360 | Terms & conditions tab |
| `quote-notes-1280.png` / `quote-notes-360.png` | 1280 / 360 | Notes tab (customer + internal) |
| `quote-signoff-1280.png` / `quote-signoff-360.png` | 1280 / 360 | Sign-off tab |
| `quote-add-customer-1280.png` / `quote-add-customer-360.png` | 1280 / 360 | Add-customer drawer |
| `quote-print-preview-1280.png` | 1280 | Print: customer notes present, internal notes absent |

Heights and `scrollWidth` (360 must equal 360 — no page side-scroll) are in `shot-report.json`.

Scripts (local throwaway DB only, `ALLOW_SEED_SHOTS=1`):

- `scripts/quote-phase1-09-seed-shots.mjs`
- `scripts/quote-phase1-09-shots.mjs`
