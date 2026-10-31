-- Customer billing & collections (booklet invoice recording; no official invoices).

-- AlterTable: DocType gains BILLING and COLLECTION
ALTER TABLE `DocumentSeries` MODIFY `docType` ENUM('QUOTE', 'SALES_ORDER', 'PURCHASE_ORDER', 'RECEIVING_REPORT', 'SUPPLIER_BILL', 'BILLING', 'COLLECTION') NOT NULL;

-- AlterTable
ALTER TABLE `DocumentVoid` MODIFY `docType` ENUM('QUOTE', 'SALES_ORDER', 'PURCHASE_ORDER', 'RECEIVING_REPORT', 'SUPPLIER_BILL', 'BILLING', 'COLLECTION') NOT NULL;

-- CreateTable
CREATE TABLE `Billing` (
    `id` VARCHAR(191) NOT NULL,
    `number` VARCHAR(40) NOT NULL,
    `salesOrderId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `invoiceNo` INTEGER NOT NULL,
    `invoiceDate` DATE NOT NULL,
    `dueDate` DATE NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `withholdingExpected` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `netExpected` DECIMAL(15, 2) NOT NULL,
    `status` ENUM('OPEN', 'PARTIALLY_PAID', 'PAID', 'VOID') NOT NULL DEFAULT 'OPEN',
    `notes` TEXT NULL,
    `voidedAt` DATETIME(3) NULL,
    `voidReason` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `updatedById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Billing_number_key`(`number`),
    UNIQUE INDEX `Billing_invoiceNo_key`(`invoiceNo`),
    INDEX `Billing_customerId_idx`(`customerId`),
    INDEX `Billing_salesOrderId_idx`(`salesOrderId`),
    INDEX `Billing_status_idx`(`status`),
    INDEX `Billing_dueDate_idx`(`dueDate`),
    INDEX `Billing_invoiceNo_idx`(`invoiceNo`),
    INDEX `Billing_invoiceDate_idx`(`invoiceDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Collection` (
    `id` VARCHAR(191) NOT NULL,
    `number` VARCHAR(40) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `method` ENUM('CASH', 'CHECK', 'BANK_TRANSFER', 'GCASH') NOT NULL,
    `reference` VARCHAR(100) NULL,
    `checkBank` VARCHAR(100) NULL,
    `checkDate` DATE NULL,
    `receiptNo` VARCHAR(64) NULL,
    `amountReceived` DECIMAL(15, 2) NOT NULL,
    `notes` TEXT NULL,
    `status` ENUM('POSTED', 'VOID') NOT NULL DEFAULT 'POSTED',
    `voidedAt` DATETIME(3) NULL,
    `voidReason` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Collection_number_key`(`number`),
    INDEX `Collection_customerId_idx`(`customerId`),
    INDEX `Collection_status_idx`(`status`),
    INDEX `Collection_date_idx`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CollectionAllocation` (
    `id` VARCHAR(191) NOT NULL,
    `collectionId` VARCHAR(191) NOT NULL,
    `billingId` VARCHAR(191) NOT NULL,
    `cashApplied` DECIMAL(15, 2) NOT NULL,
    `withholdingApplied` DECIMAL(15, 2) NOT NULL DEFAULT 0,

    UNIQUE INDEX `CollectionAllocation_collectionId_billingId_key`(`collectionId`, `billingId`),
    INDEX `CollectionAllocation_collectionId_idx`(`collectionId`),
    INDEX `CollectionAllocation_billingId_idx`(`billingId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Withholding2307` (
    `id` VARCHAR(191) NOT NULL,
    `billingId` VARCHAR(191) NULL,
    `collectionId` VARCHAR(191) NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `rate` DECIMAL(5, 4) NOT NULL,
    `atcCode` VARCHAR(20) NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `periodFrom` DATE NULL,
    `periodTo` DATE NULL,
    `status` ENUM('PENDING', 'RECEIVED') NOT NULL DEFAULT 'PENDING',
    `receivedAt` DATE NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Withholding2307_customerId_idx`(`customerId`),
    INDEX `Withholding2307_billingId_idx`(`billingId`),
    INDEX `Withholding2307_collectionId_idx`(`collectionId`),
    INDEX `Withholding2307_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable: DocumentAttachment gains billing / collection / 2307 owners
ALTER TABLE `DocumentAttachment` ADD COLUMN `billingId` VARCHAR(191) NULL,
    ADD COLUMN `collectionId` VARCHAR(191) NULL,
    ADD COLUMN `withholding2307Id` VARCHAR(191) NULL;

CREATE INDEX `DocumentAttachment_billingId_idx` ON `DocumentAttachment`(`billingId`);
CREATE INDEX `DocumentAttachment_collectionId_idx` ON `DocumentAttachment`(`collectionId`);
CREATE INDEX `DocumentAttachment_withholding2307Id_idx` ON `DocumentAttachment`(`withholding2307Id`);

-- AddForeignKey
ALTER TABLE `Billing` ADD CONSTRAINT `Billing_salesOrderId_fkey` FOREIGN KEY (`salesOrderId`) REFERENCES `SalesOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Billing` ADD CONSTRAINT `Billing_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Billing` ADD CONSTRAINT `Billing_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Billing` ADD CONSTRAINT `Billing_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Collection` ADD CONSTRAINT `Collection_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Collection` ADD CONSTRAINT `Collection_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CollectionAllocation` ADD CONSTRAINT `CollectionAllocation_collectionId_fkey` FOREIGN KEY (`collectionId`) REFERENCES `Collection`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CollectionAllocation` ADD CONSTRAINT `CollectionAllocation_billingId_fkey` FOREIGN KEY (`billingId`) REFERENCES `Billing`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Withholding2307` ADD CONSTRAINT `Withholding2307_billingId_fkey` FOREIGN KEY (`billingId`) REFERENCES `Billing`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Withholding2307` ADD CONSTRAINT `Withholding2307_collectionId_fkey` FOREIGN KEY (`collectionId`) REFERENCES `Collection`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Withholding2307` ADD CONSTRAINT `Withholding2307_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DocumentAttachment` ADD CONSTRAINT `DocumentAttachment_billingId_fkey` FOREIGN KEY (`billingId`) REFERENCES `Billing`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DocumentAttachment` ADD CONSTRAINT `DocumentAttachment_collectionId_fkey` FOREIGN KEY (`collectionId`) REFERENCES `Collection`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DocumentAttachment` ADD CONSTRAINT `DocumentAttachment_withholding2307Id_fkey` FOREIGN KEY (`withholding2307Id`) REFERENCES `Withholding2307`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- BEGIN billing settings
-- Settings → Numbering gains billing (BL) and collection (CR); new sections
-- invoiceBooklet { seriesFrom, seriesTo, label } and collections { overdueGraceDays }.
-- Settings are versioned (never edited in place), so if the latest version lacks
-- any of these, add a new version with the defaults. Running this again adds
-- nothing (tests/db/billing.db.test.ts runs it twice).
INSERT INTO `SettingsVersion` (`id`, `version`, `data`, `changedKey`, `before`, `after`, `effectiveFrom`, `createdById`)
SELECT
    CONCAT('mig_billing_settings_', sv.`version` + 1),
    sv.`version` + 1,
    JSON_SET(
      JSON_SET(
        JSON_SET(
          JSON_SET(sv.`data`,
            '$.numbering.billing', JSON_OBJECT('prefix', 'BL', 'padding', 4, 'resetYearly', true)),
          '$.numbering.collection', JSON_OBJECT('prefix', 'CR', 'padding', 4, 'resetYearly', true)),
        '$.invoiceBooklet', JSON_OBJECT('seriesFrom', 1, 'seriesTo', 500, 'label', 'Booklet 1')),
      '$.collections', JSON_OBJECT('overdueGraceDays', 0)
    ),
    'numbering',
    JSON_EXTRACT(sv.`data`, '$.numbering'),
    JSON_SET(
      JSON_SET(JSON_EXTRACT(sv.`data`, '$.numbering'),
        '$.billing', JSON_OBJECT('prefix', 'BL', 'padding', 4, 'resetYearly', true)),
      '$.collection', JSON_OBJECT('prefix', 'CR', 'padding', 4, 'resetYearly', true)
    ),
    CURRENT_TIMESTAMP(3),
    NULL
FROM `SettingsVersion` sv
WHERE sv.`version` = (SELECT MAX(`version`) FROM (SELECT `version` FROM `SettingsVersion`) AS latest)
  AND JSON_CONTAINS_PATH(sv.`data`, 'one', '$.numbering')
  AND (
    NOT JSON_CONTAINS_PATH(sv.`data`, 'one', '$.numbering.billing')
    OR NOT JSON_CONTAINS_PATH(sv.`data`, 'one', '$.numbering.collection')
    OR NOT JSON_CONTAINS_PATH(sv.`data`, 'one', '$.invoiceBooklet')
    OR NOT JSON_CONTAINS_PATH(sv.`data`, 'one', '$.collections')
  );
-- END billing settings
