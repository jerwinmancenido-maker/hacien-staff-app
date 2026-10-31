<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Cursor Cloud specific instructions

- Node 22 is on the default image. `install` adds MySQL 8 when `mysqld` is missing, then runs `npm ci` (the `postinstall` script generates the Prisma client).
- `start` launches MySQL with `mysqld --daemonize` because this VM has no systemd (`service mysql start` is denied). It writes a gitignored `.env` for the local `hacien` and `hacien_test` databases, runs `npx prisma migrate deploy`, loads sample data, and runs `npm run dev` on port 3000.
- Sign in as `jerwin@example.com` with the `SEED_PASSWORD` value in `.env`. `staff@example.com` and `viewer@example.com` use the same sample password. Leave `SMTP_HOST` empty; reset links print in the dev server log.
- Checks: `npm run lint`, `npm run typecheck`, `npm test` (the `tests/db` suites use `TEST_DATABASE_URL` from `.env`), and `npm run build`. Prefer `npx prisma migrate deploy` over `npm run db:migrate` (`migrate dev` can prompt).
