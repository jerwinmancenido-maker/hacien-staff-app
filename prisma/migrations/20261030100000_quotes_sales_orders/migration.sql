-- AlterTable
ALTER TABLE `AuditLog` MODIFY `action` ENUM('create', 'update', 'archive', 'restore', 'void', 'login', 'login_failed', 'settings_change', 'email_draft') NOT NULL;

-- AlterTable
ALTER TABLE `Customer` ADD COLUMN `defaultWithholding` JSON NULL;

-- CreateTable
CREATE TABLE `WithholdingRate` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `label` VARCHAR(100) NOT NULL,
    `lineKind` ENUM('GOODS', 'SERVICES', 'GOV_PT', 'GOV_VAT') NOT NULL,
    `atcCode` VARCHAR(20) NULL,
    `rate` DECIMAL(5, 4) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `note` VARCHAR(255) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `WithholdingRate_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DocumentSeries` (
    `id` VARCHAR(191) NOT NULL,
    `docType` ENUM('QUOTE', 'SALES_ORDER') NOT NULL,
    `year` INTEGER NOT NULL,
    `prefix` VARCHAR(10) NOT NULL,
    `nextNumber` INTEGER NOT NULL DEFAULT 1,
    `padding` INTEGER NOT NULL DEFAULT 4,

    UNIQUE INDEX `DocumentSeries_docType_year_key`(`docType`, `year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DocumentVoid` (
    `id` VARCHAR(191) NOT NULL,
    `docType` ENUM('QUOTE', 'SALES_ORDER') NOT NULL,
    `docNumber` VARCHAR(40) NOT NULL,
    `docId` VARCHAR(64) NOT NULL,
    `reason` TEXT NOT NULL,
    `snapshot` JSON NOT NULL,
    `voidedById` VARCHAR(191) NOT NULL,
    `voidedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DocumentVoid_docType_docId_idx`(`docType`, `docId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Quote` (
    `id` VARCHAR(191) NOT NULL,
    `number` VARCHAR(40) NOT NULL,
    `revision` INTEGER NOT NULL DEFAULT 1,
    `customerId` VARCHAR(191) NOT NULL,
    `contactId` VARCHAR(191) NULL,
    `date` DATE NOT NULL,
    `validUntil` DATE NOT NULL,
    `status` ENUM('DRAFT', 'SENT', 'WON', 'LOST', 'VOID') NOT NULL DEFAULT 'DRAFT',
    `terms` VARCHAR(100) NULL,
    `notes` TEXT NULL,
    `settingsVersionId` VARCHAR(191) NOT NULL,
    `withholding` JSON NOT NULL,
    `contractPrice` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `withholdingTotal` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `netReceived` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `supplierCost` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `netMargin` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `netMarginPct` DECIMAL(7, 2) NOT NULL DEFAULT 0,
    `voidedAt` DATETIME(3) NULL,
    `voidReason` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `updatedById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Quote_number_key`(`number`),
    INDEX `Quote_customerId_idx`(`customerId`),
    INDEX `Quote_status_idx`(`status`),
    INDEX `Quote_date_idx`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `QuoteItem` (
    `id` VARCHAR(191) NOT NULL,
    `quoteId` VARCHAR(191) NOT NULL,
    `sortOrder` INTEGER NOT NULL,
    `description` TEXT NOT NULL,
    `kind` ENUM('GOODS', 'SERVICES') NOT NULL,
    `qty` DECIMAL(12, 2) NOT NULL,
    `unit` VARCHAR(30) NOT NULL,
    `supplierId` VARCHAR(191) NULL,
    `supplierUnitCost` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `unitPrice` DECIMAL(15, 2) NOT NULL,
    `total` DECIMAL(15, 2) NOT NULL,
    `supplierTotal` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `margin` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `removedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `QuoteItem_quoteId_idx`(`quoteId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SalesOrder` (
    `id` VARCHAR(191) NOT NULL,
    `number` VARCHAR(40) NOT NULL,
    `quoteId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `contactId` VARCHAR(191) NULL,
    `date` DATE NOT NULL,
    `status` ENUM('OPEN', 'VOID') NOT NULL DEFAULT 'OPEN',
    `buyerPoNo` VARCHAR(64) NULL,
    `buyerPoDate` DATE NULL,
    `deliveryAddress` TEXT NULL,
    `terms` VARCHAR(100) NULL,
    `notes` TEXT NULL,
    `settingsVersionId` VARCHAR(191) NOT NULL,
    `withholding` JSON NOT NULL,
    `contractPrice` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `withholdingTotal` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `netReceived` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `supplierCost` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `netMargin` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `netMarginPct` DECIMAL(7, 2) NOT NULL DEFAULT 0,
    `voidedAt` DATETIME(3) NULL,
    `voidReason` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `updatedById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SalesOrder_number_key`(`number`),
    INDEX `SalesOrder_quoteId_idx`(`quoteId`),
    INDEX `SalesOrder_customerId_idx`(`customerId`),
    INDEX `SalesOrder_status_idx`(`status`),
    INDEX `SalesOrder_date_idx`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SalesOrderItem` (
    `id` VARCHAR(191) NOT NULL,
    `salesOrderId` VARCHAR(191) NOT NULL,
    `sortOrder` INTEGER NOT NULL,
    `description` TEXT NOT NULL,
    `kind` ENUM('GOODS', 'SERVICES') NOT NULL,
    `qty` DECIMAL(12, 2) NOT NULL,
    `unit` VARCHAR(30) NOT NULL,
    `supplierId` VARCHAR(191) NULL,
    `supplierUnitCost` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `unitPrice` DECIMAL(15, 2) NOT NULL,
    `total` DECIMAL(15, 2) NOT NULL,
    `supplierTotal` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `margin` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `removedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SalesOrderItem_salesOrderId_idx`(`salesOrderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `DocumentVoid` ADD CONSTRAINT `DocumentVoid_voidedById_fkey` FOREIGN KEY (`voidedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Quote` ADD CONSTRAINT `Quote_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Quote` ADD CONSTRAINT `Quote_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Quote` ADD CONSTRAINT `Quote_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Quote` ADD CONSTRAINT `Quote_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QuoteItem` ADD CONSTRAINT `QuoteItem_quoteId_fkey` FOREIGN KEY (`quoteId`) REFERENCES `Quote`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QuoteItem` ADD CONSTRAINT `QuoteItem_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesOrder` ADD CONSTRAINT `SalesOrder_quoteId_fkey` FOREIGN KEY (`quoteId`) REFERENCES `Quote`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesOrder` ADD CONSTRAINT `SalesOrder_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesOrder` ADD CONSTRAINT `SalesOrder_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesOrder` ADD CONSTRAINT `SalesOrder_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesOrder` ADD CONSTRAINT `SalesOrder_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesOrderItem` ADD CONSTRAINT `SalesOrderItem_salesOrderId_fkey` FOREIGN KEY (`salesOrderId`) REFERENCES `SalesOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesOrderItem` ADD CONSTRAINT `SalesOrderItem_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Data: default withholding rates (production needs these; the sample seed
-- refuses to run there). Every rate must be verified with the BIR / accountant.
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO `WithholdingRate` (`id`, `code`, `label`, `lineKind`, `atcCode`, `rate`, `active`, `note`, `sortOrder`, `updatedAt`) VALUES
    ('whr_goods_1', 'GOODS_1', 'Goods 1%', 'GOODS', NULL, 0.0100, true, 'verify with BIR', 1, CURRENT_TIMESTAMP(3)),
    ('whr_services_2', 'SERVICES_2', 'Services 2%', 'SERVICES', NULL, 0.0200, true, 'verify with BIR', 2, CURRENT_TIMESTAMP(3)),
    ('whr_gov_pt_3', 'GOV_PT_3', 'Government percentage tax 3%', 'GOV_PT', NULL, 0.0300, true, 'verify with BIR', 3, CURRENT_TIMESTAMP(3)),
    ('whr_gov_vat_5', 'GOV_VAT_5', 'Government VAT 5%', 'GOV_VAT', NULL, 0.0500, true, 'verify with BIR', 4, CURRENT_TIMESTAMP(3));

-- ---------------------------------------------------------------------------
-- Data: quote numbers change from Q-2026-0001 to QT-2026-0001. Settings are
-- versioned (never edited in place), so if the latest version still has the old
-- default prefix "Q", add a new version with "QT" (same as saving the Numbering
-- tab). A prefix someone already changed by hand is left alone.
-- ---------------------------------------------------------------------------
INSERT INTO `SettingsVersion` (`id`, `version`, `data`, `changedKey`, `before`, `after`, `effectiveFrom`, `createdById`)
SELECT
    CONCAT('mig_quote_prefix_qt_', sv.`version` + 1),
    sv.`version` + 1,
    JSON_SET(sv.`data`, '$.numbering.quote.prefix', 'QT'),
    'numbering',
    JSON_EXTRACT(sv.`data`, '$.numbering'),
    JSON_SET(JSON_EXTRACT(sv.`data`, '$.numbering'), '$.quote.prefix', 'QT'),
    CURRENT_TIMESTAMP(3),
    NULL
FROM `SettingsVersion` sv
WHERE sv.`version` = (SELECT MAX(`version`) FROM (SELECT `version` FROM `SettingsVersion`) AS latest)
  AND JSON_UNQUOTE(JSON_EXTRACT(sv.`data`, '$.numbering.quote.prefix')) = 'Q';
