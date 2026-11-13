-- Finish-all Phase 2 #5: quote revision links. Additive only — one new
-- nullable column + its index. No backfill: chains that existed before
-- this column cannot be reconstructed reliably (copies received fresh
-- quote numbers and no link was stored), so existing rows keep NULL and
-- the quote page shows no chain for them; every NEW REVISION copy made
-- after this migration stamps the chain's Rev 1 quote id here.
ALTER TABLE `Quote` ADD COLUMN `revisionChainId` VARCHAR(191) NULL;
ALTER TABLE `Quote` ADD INDEX `Quote_revisionChainId_idx` (`revisionChainId`);
