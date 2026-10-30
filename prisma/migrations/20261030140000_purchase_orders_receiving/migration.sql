-- AlterTable
ALTER TABLE `DocumentSeries` MODIFY `docType` ENUM('QUOTE', 'SALES_ORDER', 'PURCHASE_ORDER', 'RECEIVING_REPORT', 'SUPPLIER_BILL') NOT NULL;

-- AlterTable
ALTER TABLE `DocumentVoid` MODIFY `docType` ENUM('QUOTE', 'SALES_ORDER', 'PURCHASE_ORDER', 'RECEIVING_REPORT', 'SUPPLIER_BILL') NOT NULL;

-- CreateTable
CREATE TABLE `PurchaseOrder` (
    `id` VARCHAR(191) NOT NULL,
    `number` VARCHAR(40) NOT NULL,
    `revision` INTEGER NOT NULL DEFAULT 1,
    `status` ENUM('DRAFT', 'APPROVED', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'VOID') NOT NULL DEFAULT 'DRAFT',
    `supplierId` VARCHAR(191) NOT NULL,
    `supplierContactId` VARCHAR(191) NULL,
    `salesOrderId` VARCHAR(191) NULL,
    `date` DATE NOT NULL,
    `expectedDate` DATE NULL,
    `terms` VARCHAR(100) NULL,
    `deliveryAddressText` TEXT NULL,
    `deliveryAddressId` VARCHAR(191) NULL,
    `supplierAddressText` TEXT NULL,
    `notes` TEXT NULL,
    `settingsVersionId` VARCHAR(191) NOT NULL,
    `subtotal` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `approvedById` VARCHAR(191) NULL,
    `approvedAt` DATETIME(3) NULL,
    `sentAt` DATETIME(3) NULL,
    `closedAt` DATETIME(3) NULL,
    `closeReason` TEXT NULL,
    `voidedAt` DATETIME(3) NULL,
    `voidReason` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `updatedById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PurchaseOrder_number_key`(`number`),
    INDEX `PurchaseOrder_supplierId_idx`(`supplierId`),
    INDEX `PurchaseOrder_salesOrderId_idx`(`salesOrderId`),
    INDEX `PurchaseOrder_status_idx`(`status`),
    INDEX `PurchaseOrder_date_idx`(`date`),
    INDEX `PurchaseOrder_expectedDate_idx`(`expectedDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PurchaseOrderItem` (
    `id` VARCHAR(191) NOT NULL,
    `purchaseOrderId` VARCHAR(191) NOT NULL,
    `salesOrderItemId` VARCHAR(191) NULL,
    `activeSalesOrderItemId` VARCHAR(191) NULL,
    `sortOrder` INTEGER NOT NULL,
    `description` TEXT NOT NULL,
    `kind` ENUM('GOODS', 'SERVICES') NOT NULL,
    `qty` DECIMAL(12, 2) NOT NULL,
    `unit` VARCHAR(30) NOT NULL,
    `unitCost` DECIMAL(15, 2) NOT NULL,
    `total` DECIMAL(15, 2) NOT NULL,
    `receivedQty` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `removedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PurchaseOrderItem_activeSalesOrderItemId_key`(`activeSalesOrderItemId`),
    INDEX `PurchaseOrderItem_purchaseOrderId_idx`(`purchaseOrderId`),
    INDEX `PurchaseOrderItem_salesOrderItemId_idx`(`salesOrderItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReceivingReport` (
    `id` VARCHAR(191) NOT NULL,
    `number` VARCHAR(40) NOT NULL,
    `purchaseOrderId` VARCHAR(191) NOT NULL,
    `receivedDate` DATE NOT NULL,
    `receivedById` VARCHAR(191) NOT NULL,
    `deliveryRef` VARCHAR(64) NULL,
    `notes` TEXT NULL,
    `status` ENUM('POSTED', 'VOID') NOT NULL DEFAULT 'POSTED',
    `voidedAt` DATETIME(3) NULL,
    `voidReason` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ReceivingReport_number_key`(`number`),
    INDEX `ReceivingReport_purchaseOrderId_idx`(`purchaseOrderId`),
    INDEX `ReceivingReport_status_idx`(`status`),
    INDEX `ReceivingReport_receivedDate_idx`(`receivedDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReceivingReportItem` (
    `id` VARCHAR(191) NOT NULL,
    `receivingReportId` VARCHAR(191) NOT NULL,
    `purchaseOrderItemId` VARCHAR(191) NOT NULL,
    `qtyReceived` DECIMAL(12, 2) NOT NULL,
    `note` VARCHAR(255) NULL,

    INDEX `ReceivingReportItem_receivingReportId_idx`(`receivingReportId`),
    INDEX `ReceivingReportItem_purchaseOrderItemId_idx`(`purchaseOrderItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SupplierBill` (
    `id` VARCHAR(191) NOT NULL,
    `supplierId` VARCHAR(191) NOT NULL,
    `purchaseOrderId` VARCHAR(191) NULL,
    `billNumber` VARCHAR(64) NOT NULL,
    `activeKey` VARCHAR(255) NULL,
    `billDate` DATE NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `notes` TEXT NULL,
    `status` ENUM('RECORDED', 'VOID') NOT NULL DEFAULT 'RECORDED',
    `voidedAt` DATETIME(3) NULL,
    `voidReason` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SupplierBill_activeKey_key`(`activeKey`),
    INDEX `SupplierBill_supplierId_idx`(`supplierId`),
    INDEX `SupplierBill_purchaseOrderId_idx`(`purchaseOrderId`),
    INDEX `SupplierBill_status_idx`(`status`),
    INDEX `SupplierBill_billDate_idx`(`billDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SupplierBillItem` (
    `id` VARCHAR(191) NOT NULL,
    `supplierBillId` VARCHAR(191) NOT NULL,
    `purchaseOrderItemId` VARCHAR(191) NOT NULL,
    `qty` DECIMAL(12, 2) NOT NULL,
    `unitPrice` DECIMAL(15, 2) NOT NULL,
    `total` DECIMAL(15, 2) NOT NULL,

    INDEX `SupplierBillItem_supplierBillId_idx`(`supplierBillId`),
    INDEX `SupplierBillItem_purchaseOrderItemId_idx`(`purchaseOrderItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DocumentAttachment` (
    `id` VARCHAR(191) NOT NULL,
    `receivingReportId` VARCHAR(191) NULL,
    `supplierBillId` VARCHAR(191) NULL,
    `fileName` VARCHAR(255) NOT NULL,
    `mimeType` VARCHAR(100) NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `storageKey` VARCHAR(64) NOT NULL,
    `sha256` VARCHAR(64) NOT NULL,
    `uploadedById` VARCHAR(191) NOT NULL,
    `archivedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `DocumentAttachment_storageKey_key`(`storageKey`),
    INDEX `DocumentAttachment_receivingReportId_idx`(`receivingReportId`),
    INDEX `DocumentAttachment_supplierBillId_idx`(`supplierBillId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PurchaseOrder` ADD CONSTRAINT `PurchaseOrder_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseOrder` ADD CONSTRAINT `PurchaseOrder_supplierContactId_fkey` FOREIGN KEY (`supplierContactId`) REFERENCES `Contact`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseOrder` ADD CONSTRAINT `PurchaseOrder_salesOrderId_fkey` FOREIGN KEY (`salesOrderId`) REFERENCES `SalesOrder`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseOrder` ADD CONSTRAINT `PurchaseOrder_deliveryAddressId_fkey` FOREIGN KEY (`deliveryAddressId`) REFERENCES `Address`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseOrder` ADD CONSTRAINT `PurchaseOrder_approvedById_fkey` FOREIGN KEY (`approvedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseOrder` ADD CONSTRAINT `PurchaseOrder_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseOrder` ADD CONSTRAINT `PurchaseOrder_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseOrderItem` ADD CONSTRAINT `PurchaseOrderItem_purchaseOrderId_fkey` FOREIGN KEY (`purchaseOrderId`) REFERENCES `PurchaseOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseOrderItem` ADD CONSTRAINT `PurchaseOrderItem_salesOrderItemId_fkey` FOREIGN KEY (`salesOrderItemId`) REFERENCES `SalesOrderItem`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReceivingReport` ADD CONSTRAINT `ReceivingReport_purchaseOrderId_fkey` FOREIGN KEY (`purchaseOrderId`) REFERENCES `PurchaseOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReceivingReport` ADD CONSTRAINT `ReceivingReport_receivedById_fkey` FOREIGN KEY (`receivedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReceivingReport` ADD CONSTRAINT `ReceivingReport_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReceivingReportItem` ADD CONSTRAINT `ReceivingReportItem_receivingReportId_fkey` FOREIGN KEY (`receivingReportId`) REFERENCES `ReceivingReport`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReceivingReportItem` ADD CONSTRAINT `ReceivingReportItem_purchaseOrderItemId_fkey` FOREIGN KEY (`purchaseOrderItemId`) REFERENCES `PurchaseOrderItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupplierBill` ADD CONSTRAINT `SupplierBill_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupplierBill` ADD CONSTRAINT `SupplierBill_purchaseOrderId_fkey` FOREIGN KEY (`purchaseOrderId`) REFERENCES `PurchaseOrder`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupplierBill` ADD CONSTRAINT `SupplierBill_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupplierBillItem` ADD CONSTRAINT `SupplierBillItem_supplierBillId_fkey` FOREIGN KEY (`supplierBillId`) REFERENCES `SupplierBill`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupplierBillItem` ADD CONSTRAINT `SupplierBillItem_purchaseOrderItemId_fkey` FOREIGN KEY (`purchaseOrderItemId`) REFERENCES `PurchaseOrderItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DocumentAttachment` ADD CONSTRAINT `DocumentAttachment_receivingReportId_fkey` FOREIGN KEY (`receivingReportId`) REFERENCES `ReceivingReport`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DocumentAttachment` ADD CONSTRAINT `DocumentAttachment_supplierBillId_fkey` FOREIGN KEY (`supplierBillId`) REFERENCES `SupplierBill`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DocumentAttachment` ADD CONSTRAINT `DocumentAttachment_uploadedById_fkey` FOREIGN KEY (`uploadedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- BEGIN receiving report numbering
-- Data: Settings → Numbering gains "Receiving reports" (RR-2026-0001). Settings
-- are versioned (never edited in place), so if the latest version has no
-- receivingReport format yet, add a new version with the default (same as
-- saving the Numbering tab). Running this again adds nothing
-- (tests/db/purchasing.db.test.ts runs it twice).
INSERT INTO `SettingsVersion` (`id`, `version`, `data`, `changedKey`, `before`, `after`, `effectiveFrom`, `createdById`)
SELECT
    CONCAT('mig_rr_numbering_', sv.`version` + 1),
    sv.`version` + 1,
    JSON_SET(sv.`data`, '$.numbering.receivingReport', JSON_OBJECT('prefix', 'RR', 'padding', 4, 'resetYearly', true)),
    'numbering',
    JSON_EXTRACT(sv.`data`, '$.numbering'),
    JSON_SET(JSON_EXTRACT(sv.`data`, '$.numbering'), '$.receivingReport', JSON_OBJECT('prefix', 'RR', 'padding', 4, 'resetYearly', true)),
    CURRENT_TIMESTAMP(3),
    NULL
FROM `SettingsVersion` sv
WHERE sv.`version` = (SELECT MAX(`version`) FROM (SELECT `version` FROM `SettingsVersion`) AS latest)
  AND JSON_CONTAINS_PATH(sv.`data`, 'one', '$.numbering')
  AND NOT JSON_CONTAINS_PATH(sv.`data`, 'one', '$.numbering.receivingReport');
-- END receiving report numbering
