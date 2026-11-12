-- Supplier bank details: the bank is the SUPPLIER's own bank, not always
-- UnionBank. Additive only — a dedicated bankName column; existing rows stay
-- NULL and are NOT rewritten. Legacy rows typed the bank into the combined
-- bankBranch text ("UnionBank – Ortigas"); the app resolves those at read
-- time (src/lib/banks.ts resolveSupplierBank) and the next save of the
-- supplier writes bankName + branch separately.
ALTER TABLE `Supplier` ADD COLUMN `bankName` VARCHAR(191) NULL;
