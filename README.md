# hacien-staff-app

HACIEN staff app: quotes, sales orders, supplier POs, billing, collections and simple BIR books for a small Philippine IT supplier. AGPL-3.0.

**Phase 1, Part 1** covers the app shell, sign-in, users and roles, versioned settings, customers, suppliers, contacts and the audit log. **Part 2** adds quotes, sales orders, document numbering, withholding rates and print-to-PDF. **Brief 03** adds structured Philippine addresses, business document uploads (DTI, SEC, BIR 2303, permits) with expiry tracking, and a Transactions tab on customers and suppliers. **Part 4** adds supplier POs, receiving and supplier bills. **Part 5** adds customer billings and collections. **Part 6** adds hand-recorded supplier payments (payables), behind a feature flag that is **OFF by default**.

Stack: Next.js 16 (App Router, TypeScript strict), Prisma 6, MySQL 8, zod, bcryptjs, nodemailer, qrcode, Vitest. Plain CSS following `docs/design-brief.md`.

---

## Local setup

Requirements: **Node 22** and **MySQL 8**.

```bash
npm install                      # also runs `prisma generate`
cp .env.example .env             # then fill in DATABASE_URL and SESSION_SECRET
                                 # (e.g. SESSION_SECRET=$(openssl rand -hex 32))
npm run db:migrate               # prisma migrate dev: creates tables
SEED_SAMPLE=true SEED_PASSWORD='pick-one' npm run db:seed   # fake sample users, customers, suppliers, contacts, 2 quotes + 1 SO
npm run dev                      # http://localhost:3000
```

The seed loads fake sample data only when `SEED_SAMPLE=true`, and always refuses when `NODE_ENV=production`. Sample users get the password in `SEED_PASSWORD` (or a random one if unset — use **Forgot password**). The seed never prints passwords. Sample sign-ins:

| Email | Roles | Can see costs |
|---|---|---|
| jerwin@example.com | Admin + Approver | yes |
| staff@example.com | Staff | no |
| viewer@example.com | Viewer | no |

The seed is safe to run again: it only adds what's missing and never deletes.

**Mail:** leave `SMTP_HOST` empty in development. Reset and invite links are then printed to the server console. Set the `SMTP_*` and `MAIL_FROM` variables to send real mail.

## Checks

```bash
npm run lint        # eslint
npm run typecheck   # tsc --noEmit
npm test            # vitest; the database suites in tests/db are skipped unless TEST_DATABASE_URL is set
TEST_DATABASE_URL=mysql://USER:PASS@127.0.0.1:3306/hacien_test npm test   # also runs the MySQL suites
npm run build       # prisma generate + next build
```

The Vitest suites (`tests/`) cover:
- role permissions, `canSeeCosts()` / `stripCosts()`, and the last-Admin / last-Approver guard
- settings versioning, including a test that an old version stays readable after a change
- the no-delete rules: the Prisma extension throws on `delete` / `deleteMany`, and a source scan finds no DELETE routes or delete calls
- TIN, customer, supplier and contact validation; main-contact rules; audit diffs; the login rate limit; peso and Manila date formatting
- quote math (line totals, supplier total = supplier unit × buyer qty, withholding by line kind, net received, net margin ₱ and %, rounding) and the print page (NON-VAT, QR, no costs)
- addresses (validation, ZIP, formatter, default and owner rules), upload checks (magic bytes, size limit, file names, storage keys, `UPLOAD_DIR` guard), expiry badges, transaction sums, the `/files` 401
- **against MySQL** (`tests/db`, needs `TEST_DATABASE_URL`): legacy address migration; address defaults / supplier rule / audit; print and Convert-to-SO addresses; upload → download permission matrix, path traversal, fake / oversized files, archived documents hidden, replace; Transactions filters, totals, pagination and no cost fields for staff / viewers; and from Part 2: 20 parallel creates get 20 consecutive numbers, QT and SO counters are separate, a new year restarts at 0001, voided numbers are never reissued, failed transactions don't use a number; customer default withholding is copied, overrides are saved, and a Settings change doesn't alter an existing quote; non-cost users' quote/SO payloads have no cost or margin fields; convert / void rules and the DocumentVoid log; deletes still throw

The database suites apply migrations to `TEST_DATABASE_URL` first and refuse a database whose name doesn't contain `test`. They never clean up (nothing is deleted); each run uses its own records and unused years.

## Deploying to Hostinger (Node.js app)

1. **Create the database** in hPanel: **Databases → MySQL Databases**. Create a database and a user and note the host, name, user and password.
2. **Create the Node.js app** in hPanel (**Websites → Node.js**, or "Add website → Node.js app"). Pick **Node 22** and connect this Git repo (or upload it).
3. **Set environment variables** in the app's settings (see `.env.example`):
   - `DATABASE_URL=mysql://USER:PASSWORD@HOST:3306/DBNAME`
   - `SESSION_SECRET`: a long random string
   - `APP_URL`: the public `https://` URL (used in email links)
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`: for example, a Hostinger email account's SMTP
   - `NODE_ENV=production`
   - `UPLOAD_DIR`: where uploaded business documents are stored, **outside** the app directory (each deploy replaces the app directory), e.g. `/home/<user>/hacien-uploads/<env>`. It's created if missing. Never under `public/` or `.next/` (the app refuses). Add it to the existing env vars; don't replace the whole set (that rotates the DB password and session secret).
   - `UPLOAD_MAX_MB` (optional, default 10): upload size limit.
   - `TRUSTED_PROXY_COUNT`: how many reverse proxies append to `X-Forwarded-For` (default `1`). The client IP for rate limits is read that many entries from the right; the client-supplied left side is never trusted.
   - **Payables (Part 6):** OFF by default. For staging, either turn on **Settings → Features → Enable Payables**, or set `PAYABLES_ENABLED=true` (env wins when set). Do not enable in production until reviewed.
4. **Build command:** `npm ci && npm run build` (or `npm run staging:build`, which also runs `prisma migrate deploy`). `next.config.ts` builds on one CPU without worker threads, because Hostinger can't spawn them ("OS can't spawn worker thread"). Set `HOSTINGER_BUILD=1` to also skip the build's own type check there; CI still runs lint and `tsc`.
5. **Run migrations** (every deploy that adds migrations), from the app's terminal/SSH or as a pre-start step:
   ```bash
   npx prisma migrate deploy
   ```
   Don't run the seed in production (it refuses). Settings version 1 is created automatically from the defaults on first use; create the first admin user from a development copy or the database.
6. **Start command:** `npm start`. This runs `next start`, which listens on the `PORT` that Hostinger provides.

No Docker, Vercel or edge runtime is used. The `src/proxy.ts` request check runs on the Node runtime.

## How things work

### Auth: hand-rolled DB sessions (not Auth.js)
Only email + password is needed, so a small session table is simpler to audit than Auth.js with a credentials provider:
- Passwords are hashed with **bcrypt** (`bcryptjs`, pure JS, so there's nothing native to compile on shared hosting).
- On sign-in, a random 256-bit token goes in the `hacien_session` cookie (httpOnly, `secure` in production or whenever `APP_URL` is `https://`, SameSite=Lax, 7 days). The DB stores only its HMAC-SHA256 (keyed with `SESSION_SECRET`).
- Signing out, turning a user off and changing a password all **revoke** sessions (`revokedAt`). Session rows are never deleted.
- **Rate limit:** 5 failed sign-ins per email + IP within 15 minutes blocks further tries for that pair, and 20 failures for one email from any mix of IPs blocks that email (stored in the `LoginAttempt` table). The IP comes from the proxy-appended end of `X-Forwarded-For` (see `TRUSTED_PROXY_COUNT`), so a forged header can't reset the count.
- **Forgot password** always shows the same message. Reset links last 1 hour and invite links 7 days. Both are single-use, asking for a new link cancels older unused ones, and only their hash is stored.
- `src/proxy.ts` only redirects visitors without a cookie. **Every page and server action checks permissions on the server** (`requirePagePermission` / `requireActionPermission` in `src/lib/auth/current-user.ts`).

### Roles
Each user has one or more roles: Admin, Approver, Staff, Viewer (stored as flags, so removing a role is an update, not a delete). Permissions are the union of the user's roles; see `src/lib/permissions.ts`. **Can see costs** is a separate per-user flag. Server code must pass cost-bearing data through `stripCosts(data, user)`. The last active Admin and the last active Approver can't be turned off or demoted.

### Settings (versioned)
Each save creates a new `SettingsVersion` row holding the **full** settings snapshot, plus who saved it, when it took effect, which section changed, and the old and new values. Code reads settings through `getSettingsSnapshot()` (`src/lib/settings`). Future documents will store the `versionId` they were created under and read it back with `getSettingsVersion(id)`. A save based on an outdated version is rejected.

### No hard deletes
`src/lib/no-delete.ts` is a Prisma client extension that throws on `delete` / `deleteMany` for every model, and on raw SQL (`$queryRaw`, `$executeRaw` and the `Unsafe` variants) containing `DELETE` or `TRUNCATE`. An ESLint rule (`eslint.config.mjs`) flags raw `DELETE FROM` / `TRUNCATE` strings and `DELETE` route handlers in source, and `tests/no-delete.test.ts` checks all of it. The app has no DELETE routes. Master data uses `active` + `archivedAt`; later documents will use `voidedAt` + a reason.

### Audit log
Every create, update, archive and restore, plus sign-ins, failed sign-ins and settings changes, writes an `AuditLog` row with the changed fields before and after. The row is written **in the same transaction** as the change. Admins see everything under **Audit log**, and each record page has an **Activity** section.

### Quotes and sales orders
- **Numbers:** `QT-2026-0001`, `SO-2026-0001`. Prefix and digits come from **Settings → Numbering**; there is one counter per document type per year (`DocumentSeries`), restarting each year (untick "Restart the counter every year" for one running counter). The number is taken inside the same transaction that creates the document, with `SELECT … FOR UPDATE` on the series row, so parallel creates queue up and a failed create rolls the counter back. Numbers are never reused: voided documents keep theirs, and `DocumentVoid` records the reason, who, when and a snapshot.
- **Math** (`src/lib/quotes/calc.ts`, exact decimals): line total = qty × HACIEN unit price; supplier total = supplier unit cost × buyer qty; contract price = sum of line totals; withholding is on the **gross** contract price (non-VAT, never ÷ 1.12): goods rates on goods lines, services rates on services lines, government percentage tax / VAT rates on the whole total; net received = contract price − withholding; net margin = net received − supplier cost, and net margin % = net margin ÷ contract price. Each line and each withholding amount is rounded to 2 decimals (half-up). Totals are stored on the document.
- **Costs:** supplier, supplier cost and margins are left out by the server (`src/lib/quotes/views.ts`) for users without **Can see costs**: not just hidden. Those users' edits keep the existing costs. Audit diffs on quotes/SOs are stripped the same way.
- **Statuses:** quotes go Draft → Sent → Won (by **Convert to SO**) or Lost; any quote can be voided (reason required), except a Won quote with an open SO ("Void the sales order first."). Sales orders are made only by converting a quote and are Open or Void; voiding an SO puts its quote back to Sent. Voided documents are read-only. Removed item lines are marked `removedAt`, never deleted.
- **Needs approval** (display only for now): shown when net margin % is below, or the total above, the approval rules in the settings version the quote was made under.
- **Email** builds a draft (to the quote's contact or the main contact) to copy or open with `mailto:`. The app **never sends** it; each draft is logged as `email_draft`.
- The ₱3M non-VAT meter is **not** fed from quotes or SOs; it will use invoices in a later part.

### Withholding rates (Settings → Withholding)
An editable table (code, label, applies to, ATC code, rate %, active, note). The defaults (Goods 1%, Services 2%, Government percentage tax 3%, Government VAT 5%) are inserted by the migration with the note "verify with BIR"; **every rate must be verified with the BIR / accountant**, and the tab says so. Saving writes a new settings version (shown in the change log) and an audit row. Rates are never deleted; untick Active instead.

Each customer has a **default withholding** (any set of rate codes, possibly none), set on the customer form. A new quote copies it, staff can change it per quote, and the quote stores a snapshot of the rate values, so editing a rate later never changes existing quotes.

### Print / Save PDF
**Actions → Print / Save PDF** opens `/print/quotes/:id` (or `/print/sales-orders/:id`) in a new tab: a server-rendered A4 page with print CSS. Click **Print / Save PDF** and pick **Save as PDF** in the browser's print dialog; the file name defaults to the document number and customer. The page shows HACIEN's name, TIN and address from **Settings → Company** (as of the document's settings version), a **NON-VAT** label, the number and dates, the customer and contact, items with qty, unit, unit price and total, the contract price and terms, and a footer: "This is a system-generated document. No signature required." with a QR code to https://haciensolutions.com/terms (generated on the server with the `qrcode` package, MIT). It never shows supplier costs, margins or the withholding breakdown, and has no signature lines. Viewers can print.

### Addresses
Customers and suppliers have any number of structured addresses (`Address`: billing, delivery, office, warehouse, other; unit/building/street, barangay, city/municipality, province, 4-digit ZIP) on the **Details** tab. Each kind has one default; the first of a kind becomes its default, and archiving a default promotes the next one. Suppliers must keep an office or billing address. Province and city fields suggest values from a built-in list (no external API). `formatAddress()` (`src/lib/addresses/format.ts`) gives the one-line and multi-line text used by print (customer block = default billing address) and by **Convert to SO** (pick a saved address, still editable; the SO stores the text as a snapshot). The migration copied each old free-text address into the street of a default billing address marked **Needs review**; saving it clears the flag. The old `address` columns stay for one release and will then be dropped.

### Business documents
The **Documents** tab stores DTI / SEC / CDA registrations, BIR 2303, Mayor's permit, PhilGEPS, barangay and tax clearances. Only PDF, JPG and PNG are accepted, checked by the file's first bytes (not the name or MIME type) and matching the extension, up to `UPLOAD_MAX_MB`. Files are saved under `UPLOAD_DIR` with a random key as the name; the user's file name is only metadata. Downloads go through `/files/business-documents/:id`, which checks the session and permission (signed out → 401), sends `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff` and `Cache-Control: private, no-store`, and logs a `download` audit row. Admin/Staff/Approver upload, replace and archive; Viewers only view and download. **Replace** uploads a new file and archives the old one. Badges show **Expired** or **Expires in N days** (window in **Settings → Lists → Business documents**, default 30); the overview card counts them and the Customers / Suppliers lists have an **Expiring documents** filter.

### Transactions tab
`?tab=transactions&contact=&type=&status=&page=` on customer and supplier pages, built from one service, `listTransactions()` (`src/lib/services/transactions.ts`), returning `{ kind, id, number, date, status, contactName, total, href }` rows so POs, invoices and payments can be added as new kinds. Newest first, 50 per page, with totals per type over all pages (void documents counted separately, not added). Supplier cost and margin are only in the payload for **Can see costs** users. A supplier's tab lists the quotes / SOs that have its lines (one row per document, totals of its lines only); because which supplier is on a quote is itself cost data, users without **Can see costs** see a notice instead. Each contact card links to **View transactions** filtered to that contact. The overview's Open quotes / Open SOs / Last activity cards use real data.

## Project layout

```
prisma/              schema, migrations, seed.mts
src/proxy.ts         cookie presence check → /login
src/app/             routes (login, (app)/customers, suppliers, contacts, quotes, sales-orders, settings, audit, print/…)
src/components/      shell, DataTable (clickable rows, sorting), dialogs, form helpers
src/lib/             db, auth, permissions, settings, services, validation, audit, mailer, format,
                     quotes (calc, items, views), documents (number series, shared helpers), print (QR)
tests/               vitest (tests/db: MySQL suites)
docs/                design brief, screenshots
```
