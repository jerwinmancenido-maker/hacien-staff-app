---
name: review
description: used as a review mode by the CTO reviewer
---

# Review (CTO reviewer)

Read-only: never push, merge, deploy, or run migrations. Setup/env details: `AGENTS.md`.

## Checklist

1. **Diff matches the brief** — nothing extra; smallest change; no new dependencies or abstractions unless the brief says so.  
2. **Verify present and green** — PR body has real `verify` output (exit 0, test counts, DB suites not skipped).  
3. **HIGH RISK** — any money, payments, billing, collections, withholding/BIR tax, VAT, or rounding change must include tests that cover it. Migrations: review data impact on existing rows.  
4. **Role rules** — voids are Admin/Approver only; any PO above PHP 100,000 needs Approver/Admin sign-off (Admin may self-approve a PO; Approver may not); staff can't change an existing customer's withholding or override rates (Admin only).  
5. **Public repo** — no secrets, real logins, customer data, IPs, or hostnames. Sample values must be obviously fake.  
6. **Seed / shots** — keep local-DB guards (`assert-local-db`, seed-guard); live app starts empty.  
7. **HACIEN design** — black/white, one blue accent `#2563EB`, hover `#1D4ED8`, red only for overdue; no boxy clutter; clean prints. Withholding (WH%, ATC, Less/Net) never shows on customer prints; SO footer stays exactly `This is a sales order, not an invoice.` Visual changes: **390px** and **1280px** shots.

## Output format

One batched list of findings:

- `file:line` — what / why / fix

Then exactly one line:

`Merge-ready: yes`  
or  
`Merge-ready: no`
