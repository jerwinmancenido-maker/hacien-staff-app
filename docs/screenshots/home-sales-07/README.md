# Home Sales (brief 07) / concept A screenshots

| File | What it shows |
| --- | --- |
| `home-a-data-1280.png` / `home-a-data-360.png` / `home-a-data-320.png` | Concept A Home with sample billed sales (320 checks no sideways scroll) |
| `home-a-empty-1280.png` / `home-a-empty-360.png` | Empty sales: flat line, copy, Go to Billing; Owed ₱0 |
| `home-a-staff-1280.png` / `home-a-staff-360.png` | Staff without `manage_billing` (no KPIs/chart) |
| `home-sales-data-1280.png` / `home-sales-data-360.png` | Earlier bar-chart Home (superseded by concept A) |
| `home-sales-empty-1280.png` / `home-sales-empty-360.png` | Earlier empty bar chart |
| `home-sales-bar-tooltip-1280.png` | Earlier bar tooltip |
| `avatar-menu-after-outside-click-1280.png` | Avatar menu closed after outside click; focus on trigger |

Throwaway **local** DB only — no live data.

## Seed / shot safety

Mutating seed scripts refuse to run unless:

1. `DATABASE_URL` host is `localhost` or `127.0.0.1` (this repo has no compose MySQL service name),
2. the database name looks like a throwaway test DB (contains `test`, `shots`, `local`, or `dev`), and
3. `ALLOW_SEED_SHOTS=1` is set.

Guard: `scripts/lib/assert-local-db.mjs`.

Screenshots are captured at real content height (no fixed tall canvas).

```bash
# Concept A (current)
ALLOW_SEED_SHOTS=1 node scripts/home-a-seed-shots.mjs fill
ALLOW_SEED_SHOTS=1 node scripts/home-a-seed-shots.mjs empty
node scripts/home-a-shots.mjs data    # CDP screenshots only (no DB writes)

# Earlier bar-chart seeds (same guard)
ALLOW_SEED_SHOTS=1 node scripts/home-sales-07-seed-shots.mjs fill
```
