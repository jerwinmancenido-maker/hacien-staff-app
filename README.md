# hacien-staff-app

HACIEN staff app: quotes, sales orders, supplier POs, billing, collections and simple BIR books for a small Philippine IT supplier. AGPL-3.0.

**Phase 1, Part 1** (this code) covers the app shell, sign-in, users and roles, versioned settings, customers, suppliers, contacts and the audit log. Quotes, SOs, POs, billing and books come later.

Stack: Next.js 16 (App Router, TypeScript strict), Prisma 6, MySQL 8, zod, bcryptjs, nodemailer, Vitest. Plain CSS following `docs/design-brief.md`.

---

## Local setup

Requirements: **Node 22** and **MySQL 8**.

```bash
npm install                      # also runs `prisma generate`
cp .env.example .env             # then fill in DATABASE_URL and SESSION_SECRET
                                 # (e.g. SESSION_SECRET=$(openssl rand -hex 32))
npm run db:migrate               # prisma migrate dev: creates tables
SEED_SAMPLE=true SEED_PASSWORD='pick-one' npm run db:seed   # fake sample users, customers, suppliers, contacts
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
npm test            # vitest (no database needed)
npm run build       # prisma generate + next build
```

The Vitest suites (`tests/`) cover:
- role permissions, `canSeeCosts()` / `stripCosts()`, and the last-Admin / last-Approver guard
- settings versioning, including a test that an old version stays readable after a change
- the no-delete rules: the Prisma extension throws on `delete` / `deleteMany`, and a source scan finds no DELETE routes or delete calls
- TIN, customer, supplier and contact validation; main-contact rules; audit diffs; the login rate limit; peso and Manila date formatting

## Deploying to Hostinger (Node.js app)

1. **Create the database** in hPanel: **Databases → MySQL Databases**. Create a database and a user and note the host, name, user and password.
2. **Create the Node.js app** in hPanel (**Websites → Node.js**, or "Add website → Node.js app"). Pick **Node 22** and connect this Git repo (or upload it).
3. **Set environment variables** in the app's settings (see `.env.example`):
   - `DATABASE_URL=mysql://USER:PASSWORD@HOST:3306/DBNAME`
   - `SESSION_SECRET`: a long random string
   - `APP_URL`: the public `https://` URL (used in email links)
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`: for example, a Hostinger email account's SMTP
   - `NODE_ENV=production`
   - `TRUSTED_PROXY_COUNT`: how many reverse proxies append to `X-Forwarded-For` (default `1`). The client IP for rate limits is read that many entries from the right; the client-supplied left side is never trusted.
4. **Build command:** `npm ci && npm run build`
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

## Project layout

```
prisma/              schema, migrations, seed.mts
src/proxy.ts         cookie presence check → /login
src/app/             routes (login, (app)/customers, suppliers, contacts, settings, audit, …)
src/components/      shell, DataTable (clickable rows, sorting), dialogs, form helpers
src/lib/             db, auth, permissions, settings, services, validation, audit, mailer, format
tests/               vitest
docs/                design brief, screenshots
```
