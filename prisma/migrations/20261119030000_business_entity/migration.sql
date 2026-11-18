-- Business entity (Reconciliation Plan 2026-11-19, PR-A): a Settings-managed
-- catalogue of OTHER businesses whose transactions are recorded in this app,
-- plus a nullable businessId on Quote / SalesOrder / PurchaseOrder / Expense.
-- Additive only. Backfill: NONE — every existing row keeps businessId NULL,
-- which means "the app's own company (HACIEN)", so all existing records keep
-- their current meaning exactly. The Business table starts EMPTY (no business
-- names are seeded; Jerwin adds them in Settings when he wants them).
-- Hand-written to Prisma's generated conventions; the pre-existing schema
-- drift noted in 20261118164650 is deliberately not touched here.

CREATE TABLE `Business` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `shortLabel` VARCHAR(24) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Business_active_idx`(`active`),
    INDEX `Business_name_idx`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Quote` ADD COLUMN `businessId` VARCHAR(191) NULL;
CREATE INDEX `Quote_businessId_idx` ON `Quote`(`businessId`);
ALTER TABLE `Quote` ADD CONSTRAINT `Quote_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `SalesOrder` ADD COLUMN `businessId` VARCHAR(191) NULL;
CREATE INDEX `SalesOrder_businessId_idx` ON `SalesOrder`(`businessId`);
ALTER TABLE `SalesOrder` ADD CONSTRAINT `SalesOrder_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `PurchaseOrder` ADD COLUMN `businessId` VARCHAR(191) NULL;
CREATE INDEX `PurchaseOrder_businessId_idx` ON `PurchaseOrder`(`businessId`);
ALTER TABLE `PurchaseOrder` ADD CONSTRAINT `PurchaseOrder_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `Expense` ADD COLUMN `businessId` VARCHAR(191) NULL;
CREATE INDEX `Expense_businessId_idx` ON `Expense`(`businessId`);
ALTER TABLE `Expense` ADD CONSTRAINT `Expense_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
