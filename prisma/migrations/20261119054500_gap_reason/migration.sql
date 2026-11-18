-- Reconciliation gap reasons (PR-C, 2026-11-19). Additive only: two
-- nullable note columns on SalesOrder and PurchaseOrder. Existing rows
-- stay NULL (no reason recorded). No backfill, no data change.
ALTER TABLE `SalesOrder` ADD COLUMN `gapReasonCode` VARCHAR(40) NULL;
ALTER TABLE `SalesOrder` ADD COLUMN `gapNote` TEXT NULL;
ALTER TABLE `PurchaseOrder` ADD COLUMN `gapReasonCode` VARCHAR(40) NULL;
ALTER TABLE `PurchaseOrder` ADD COLUMN `gapNote` TEXT NULL;
