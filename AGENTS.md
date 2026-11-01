<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Workflow

Cloud agents work on a **new branch** and open a **PR to `main`**. Do not merge, deploy, run migrations against staging/live, write to any real database, or change env vars or secrets. A separate CTO reviewer reviews and merges — only with the owner's yes. Never force-push or rebase unless asked.

HACIEN is separate from PepStack Labs. Keep them apart in code, docs, and PRs.

## Setup and checks (before every push)

**Node 22** (`engines`: `>=22 <23`). Prefer `npm ci` (postinstall runs `prisma generate`).

Cloud VMs often have no systemd: start MySQL with `mysqld --daemonize` if `mysqld` is present but not running. Install MySQL 8 only when missing. Use a **throwaway local** DB only — never staging/prod.

Prefer `npx prisma migrate deploy` over `npm run db:migrate` (`migrate dev` can prompt). Optional local sample seed: `SEED_SAMPLE=true SEED_PASSWORD='…' npm run db:seed` (refuses when `NODE_ENV=production` or `SEED_SAMPLE` unset — see `src/lib/seed-guard.ts`). Leave `SMTP_HOST` empty so reset links print in the dev log.

### Env var names (dummy local values only — never real secrets)

| Name | Dummy local example |
|---|---|
| `DATABASE_URL` | `mysql://hacien:local_only_dummy@127.0.0.1:3306/hacien` |
| `TEST_DATABASE_URL` | `mysql://hacien:local_only_dummy@127.0.0.1:3306/hacien_test` (name must contain `test`) |
| `SESSION_SECRET` | any long random string (≥16 chars) |
| `APP_URL` | `http://localhost:3000` |
| `SMTP_HOST` | empty |
| `SEED_PASSWORD` | `SamplePass123!` (fake; for seed users only) |
| `SEED_SAMPLE` | `true` only when intentionally seeding locally |
| `ALLOW_SEED_SHOTS` | `1` only for local shot seed scripts |

See `.env.example` for optional flags (`PAYABLES_ENABLED`, `CASH_ENABLED`, `BOOKS_ENABLED`, `UPLOAD_DIR`, …). Do not put real tokens in code, logs, or PRs.

### Fake sample logins (after local seed)

| Email | Roles |
|---|---|
| `jerwin@example.com` | Admin + Approver (costs) |
| `staff@example.com` | Staff |
| `viewer@example.com` | Viewer |

Password = the local `SEED_PASSWORD` value (never a real password).

### Commands (`package.json`) — paste real output in the PR

1. `node -v` — expect v22.x  
2. `npm ci`  
3. Ensure throwaway MySQL + `TEST_DATABASE_URL` pointing at a `*test*` DB  
4. `npm run lint`  
5. `npm run typecheck`  
6. `npm test` — `vitest run`; includes `tests/db` when `TEST_DATABASE_URL` is set  
7. `npm run build`  

When touching those screens also run:

- `npm run test:tax-cal-layout` → `scripts/tax-calendar-layout-guard.mjs` (needs app on `BASE_URL`)
- `npm run test:items-edit-layout` → `scripts/items-edit-layout-guard.mjs`

## HIGH RISK

Money, payments, withholding / BIR codes, tax, and prints of invoices, receipts, and statements. Those changes need tests; label the PR **HIGH RISK**. Never hard-code tax or withholding rates the brief does not give.

## Seed and screenshots

Seed and screenshot scripts must refuse non-local databases (`scripts/lib/assert-local-db.mjs`: localhost / `127.0.0.1`, throwaway DB name, `ALLOW_SEED_SHOTS=1`). Never add seed data to production paths. The live app must start empty (`prisma/seed.mts` + `seed-guard`).

## UI

Before/after screenshots at **390px** and **1280px**. Brand (HACIEN): black and white, one blue accent `#2563EB`, red only for overdue, clean bold sans-serif, no boxy clutter. Prints look like clean store receipts: thin lines, plain text, no boxes or icons. Details: `docs/design-brief.md`.

## Diff discipline

No new dependencies unless the brief says so. Smallest diff that works; no new abstractions. No customer data, secrets, or tokens in code, logs, or PRs.

## Review lessons

- Fail closed: a missing setting, pinned settings version, secret, or role flag means refuse / needs approval — never fall back to latest or permissive.
- Money documents use their pinned `settingsVersionId`, not the latest settings.
- Audit/log writes go in the same transaction as the status change they record.
- Any edit to cost, price, qty, or withholding on an approved quote/PO resets approval.
- Withholding never appears on customer-facing prints.
- Seed and screenshot data must agree with the rules (e.g. a WON quote is approved).
- Remove the old UI when a new one replaces it (no duplicate chips/badges).
- Tests import the real module, never a copied version of the logic; HIGH RISK money/BIR changes need tests covering the changed logic.
- Migrations are additive with an explicit backfill; say what the backfill does in the PR.
- Visual PRs: 390 and 1280 before/after screenshots. Resolve real Bugbot findings before handoff.

## Repo map

| Path | What |
|---|---|
| `src/app/(app)/` | Authenticated routes (home, quotes, sales-orders, customers, suppliers, billing, payables, cash, books/tax, settings, …) |
| `src/app/print/` | Print views (quotes, billings, collections, statements, POs, expenses, tax worksheets, …) |
| `src/app/login/` / `forgot-password/` / `reset-password/` | Auth pages |
| `src/components/` | UI (docs, billing, payables, cash, books, purchasing, …) |
| `src/lib/` | Domain logic (auth, billing, books, cash, payables, purchasing, quotes, tax, withholding, print, seed-guard, …) |
| `src/proxy.ts` | Request gate (cookie redirect) |
| `prisma/schema.prisma` + `migrations/` + `seed.mts` | Schema, migrations, sample seed |
| `scripts/` | Layout guards + screenshot helpers; `scripts/lib/assert-local-db.mjs` |
| `tests/` | Vitest unit tests; `tests/db/` MySQL suites |
| `docs/` | Design brief + screenshot notes |
| `public/` | Static assets / brand |

