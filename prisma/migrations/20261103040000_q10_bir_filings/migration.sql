-- AlterTable
ALTER TABLE `TaxCalendarCompletion` ADD COLUMN `referenceNo` VARCHAR(100) NULL,
    ADD COLUMN `voidedAt` DATETIME(3) NULL,
    ADD COLUMN `voidReason` TEXT NULL;

-- AlterTable
ALTER TABLE `DocumentAttachment` ADD COLUMN `taxCalendarCompletionId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `DocumentAttachment_taxCalendarCompletionId_idx` ON `DocumentAttachment`(`taxCalendarCompletionId`);

-- AddForeignKey
ALTER TABLE `DocumentAttachment` ADD CONSTRAINT `DocumentAttachment_taxCalendarCompletionId_fkey` FOREIGN KEY (`taxCalendarCompletionId`) REFERENCES `TaxCalendarCompletion`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
