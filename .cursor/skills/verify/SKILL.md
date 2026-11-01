---
name: verify
description: run before every push
---

# Verify (before every push)

**Node 22** (`engines`: `>=22 <23`). Setup details (throwaway MySQL, env var names, dummy values): see `AGENTS.md`. Never point `DATABASE_URL` / `TEST_DATABASE_URL` at staging or live DBs.

## Commands (exact `package.json` scripts)

1. `node -v` — expect v22.x  
2. `npm ci` (postinstall runs `prisma generate`)  
3. Throwaway local MySQL DBs for app + tests; then `npx prisma migrate deploy` (prefer over `npm run db:migrate`)  
4. `npm run lint`  
5. `npm run typecheck`  
6. `npm test` (`vitest run`)  
7. `npm run build` (`prisma generate && next build`)

When touching those screens also run (app must be up on `BASE_URL`):

- `npm run test:tax-cal-layout` → tax calendar layout guard  
- `npm run test:items-edit-layout` → items edit layout guard  

## Passing looks like

- Every step exits **0**  
- `npm test` prints file/test counts; **DB suites included** (`tests/db`) when `TEST_DATABASE_URL` is set — not skipped  
- Lint/typecheck/build finish with no errors  

## PR body

Paste **real** command output (at least exit status + test file/test counts) into the PR body. Do not invent numbers.

## Visual changes

Attach before/after screenshots at **390px** and **1280px**.
