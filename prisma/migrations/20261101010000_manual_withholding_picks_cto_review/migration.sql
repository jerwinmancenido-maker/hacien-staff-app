-- HIGH RISK: tax — needs CTO review
--
-- Manual withholding picks (brief 10). Customer.defaultWithholding is reactivated:
--   NULL          = not set (staff must pick, or confirm "Yes, none" on submit)
--   JSON []       = explicit none
--   JSON ["CODE"] = saved rate codes from Settings → Withholding
--
-- Existing customers are reset to "not set" (NULL). Existing Quote / SalesOrder /
-- Billing rows are NOT recalculated — their snapshotted line rates and document
-- withholding JSON stay exactly as stored.
--
-- Quote.withholdingPick mirrors the quote-level pick (independent of the
-- customer after copy-on-create). NULL / [] / [codes] same semantics.
--
-- NEVER run this migration on a live production database without CTO sign-off.

-- Reset every customer's saved pick to "not set".
UPDATE `Customer` SET `defaultWithholding` = NULL;

-- Quote-level pick snapshot (copied from the customer on create; editable per quote).
ALTER TABLE `Quote` ADD COLUMN `withholdingPick` JSON NULL;
