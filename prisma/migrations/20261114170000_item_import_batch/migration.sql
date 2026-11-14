-- Phase 4 #4: CSV import batch stamp. Additive only: one nullable column
-- + index on Item. No backfill — existing rows keep NULL (created manually).
-- Old code runs against the new schema unchanged (rollback = redeploy old
-- build; the extra column is inert).

ALTER TABLE `Item` ADD COLUMN `importBatchId` VARCHAR(40) NULL;
ALTER TABLE `Item` ADD INDEX `Item_importBatchId_idx`(`importBatchId`);
