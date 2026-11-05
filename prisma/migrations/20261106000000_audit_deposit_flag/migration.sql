-- Audit E: standalone deposit / advance collection. Additive column only;
-- existing rows default false (a plain collection, not a deposit).
ALTER TABLE `Collection` ADD COLUMN `isDeposit` BOOLEAN NOT NULL DEFAULT FALSE;
