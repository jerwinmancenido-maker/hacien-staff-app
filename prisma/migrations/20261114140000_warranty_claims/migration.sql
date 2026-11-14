-- Phase 3 #8b: supplier warranty claims. Additive only: one new table
-- (with its enum) linked to ReceivingReportItem. No backfill — the
-- table starts empty and old code runs against the new schema
-- unchanged (rollback = redeploy old build; the extra table is inert).

CREATE TABLE `WarrantyClaim` (
    `id` VARCHAR(191) NOT NULL,
    `receivingReportItemId` VARCHAR(191) NOT NULL,
    `serialNumber` VARCHAR(100) NULL,
    `fault` TEXT NOT NULL,
    `supplierRef` VARCHAR(64) NULL,
    `status` ENUM('OPEN', 'SENT_TO_SUPPLIER', 'APPROVED', 'REJECTED', 'REPLACED', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `WarrantyClaim_receivingReportItemId_idx`(`receivingReportItemId`),
    INDEX `WarrantyClaim_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `WarrantyClaim` ADD CONSTRAINT `WarrantyClaim_receivingReportItemId_fkey` FOREIGN KEY (`receivingReportItemId`) REFERENCES `ReceivingReportItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `WarrantyClaim` ADD CONSTRAINT `WarrantyClaim_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
