-- Phase 4 #7 (re-planned): delivery fee as an expense linked to the order.
-- Additive only: two nullable FK columns + indexes on Expense. No backfill —
-- existing rows keep NULL (unlinked = today's behaviour). Old code runs
-- against the new schema unchanged (rollback = redeploy old build; the
-- extra columns are inert).

ALTER TABLE `Expense` ADD COLUMN `salesOrderId` VARCHAR(191) NULL;
ALTER TABLE `Expense` ADD COLUMN `purchaseOrderId` VARCHAR(191) NULL;
ALTER TABLE `Expense` ADD INDEX `Expense_salesOrderId_idx`(`salesOrderId`);
ALTER TABLE `Expense` ADD INDEX `Expense_purchaseOrderId_idx`(`purchaseOrderId`);
ALTER TABLE `Expense` ADD CONSTRAINT `Expense_salesOrderId_fkey` FOREIGN KEY (`salesOrderId`) REFERENCES `SalesOrder`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Expense` ADD CONSTRAINT `Expense_purchaseOrderId_fkey` FOREIGN KEY (`purchaseOrderId`) REFERENCES `PurchaseOrder`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
