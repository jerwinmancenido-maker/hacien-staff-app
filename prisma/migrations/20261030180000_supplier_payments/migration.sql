-- Part 6: supplier payments (hand-recorded). Additive only; safe for existing
-- staging data (POs, RRs, supplier bills).

-- AlterTable: DocType gains SUPPLIER_PAYMENT
ALTER TABLE `DocumentSeries` MODIFY `docType` ENUM('QUOTE', 'SALES_ORDER', 'PURCHASE_ORDER', 'RECEIVING_REPORT', 'SUPPLIER_BILL', 'BILLING', 'COLLECTION', 'SUPPLIER_PAYMENT') NOT NULL;
ALTER TABLE `DocumentVoid` MODIFY `docType` ENUM('QUOTE', 'SALES_ORDER', 'PURCHASE_ORDER', 'RECEIVING_REPORT', 'SUPPLIER_BILL', 'BILLING', 'COLLECTION', 'SUPPLIER_PAYMENT') NOT NULL;

-- AlterTable: SupplierBill gains dueDate (backfill from billDate) and paid statuses
ALTER TABLE `SupplierBill` ADD COLUMN `dueDate` DATE NULL;
UPDATE `SupplierBill` SET `dueDate` = `billDate` WHERE `dueDate` IS NULL;
ALTER TABLE `SupplierBill` MODIFY `dueDate` DATE NOT NULL;
CREATE INDEX `SupplierBill_dueDate_idx` ON `SupplierBill`(`dueDate`);

ALTER TABLE `SupplierBill` MODIFY `status` ENUM('RECORDED', 'PARTIALLY_PAID', 'PAID', 'VOID') NOT NULL DEFAULT 'RECORDED';

-- CreateTable
CREATE TABLE `SupplierPayment` (
    `id` VARCHAR(191) NOT NULL,
    `number` VARCHAR(40) NOT NULL,
    `supplierId` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `method` ENUM('BANK_TRANSFER', 'CHECK', 'CASH', 'E_WALLET') NOT NULL,
    `reference` VARCHAR(100) NULL,
    `checkBank` VARCHAR(100) NULL,
    `checkDate` DATE NULL,
    `amountPaid` DECIMAL(15, 2) NOT NULL,
    `notes` TEXT NULL,
    `status` ENUM('POSTED', 'VOID') NOT NULL DEFAULT 'POSTED',
    `voidedAt` DATETIME(3) NULL,
    `voidReason` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SupplierPayment_number_key`(`number`),
    INDEX `SupplierPayment_supplierId_idx`(`supplierId`),
    INDEX `SupplierPayment_status_idx`(`status`),
    INDEX `SupplierPayment_date_idx`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SupplierPaymentAllocation` (
    `id` VARCHAR(191) NOT NULL,
    `supplierPaymentId` VARCHAR(191) NOT NULL,
    `supplierBillId` VARCHAR(191) NOT NULL,
    `cashApplied` DECIMAL(15, 2) NOT NULL,
    `withholdingApplied` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `withholdingRate` DECIMAL(5, 4) NOT NULL DEFAULT 0,
    `atcCode` VARCHAR(20) NULL,

    UNIQUE INDEX `SupplierPaymentAllocation_supplierPaymentId_supplierBillId_key`(`supplierPaymentId`, `supplierBillId`),
    INDEX `SupplierPaymentAllocation_supplierPaymentId_idx`(`supplierPaymentId`),
    INDEX `SupplierPaymentAllocation_supplierBillId_idx`(`supplierBillId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SupplierWithholding2307` (
    `id` VARCHAR(191) NOT NULL,
    `supplierBillId` VARCHAR(191) NULL,
    `supplierPaymentId` VARCHAR(191) NULL,
    `supplierId` VARCHAR(191) NOT NULL,
    `rate` DECIMAL(5, 4) NOT NULL,
    `atcCode` VARCHAR(20) NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `periodFrom` DATE NULL,
    `periodTo` DATE NULL,
    `status` ENUM('TO_ISSUE', 'ISSUED') NOT NULL DEFAULT 'TO_ISSUE',
    `issuedAt` DATE NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SupplierWithholding2307_supplierId_idx`(`supplierId`),
    INDEX `SupplierWithholding2307_supplierBillId_idx`(`supplierBillId`),
    INDEX `SupplierWithholding2307_supplierPaymentId_idx`(`supplierPaymentId`),
    INDEX `SupplierWithholding2307_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable: DocumentAttachment gains supplier payment / supplier 2307 owners
ALTER TABLE `DocumentAttachment` ADD COLUMN `supplierPaymentId` VARCHAR(191) NULL,
    ADD COLUMN `supplierWithholding2307Id` VARCHAR(191) NULL;

CREATE INDEX `DocumentAttachment_supplierPaymentId_idx` ON `DocumentAttachment`(`supplierPaymentId`);
CREATE INDEX `DocumentAttachment_supplierWithholding2307Id_idx` ON `DocumentAttachment`(`supplierWithholding2307Id`);

-- AddForeignKey
ALTER TABLE `SupplierPayment` ADD CONSTRAINT `SupplierPayment_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `SupplierPayment` ADD CONSTRAINT `SupplierPayment_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `SupplierPaymentAllocation` ADD CONSTRAINT `SupplierPaymentAllocation_supplierPaymentId_fkey` FOREIGN KEY (`supplierPaymentId`) REFERENCES `SupplierPayment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `SupplierPaymentAllocation` ADD CONSTRAINT `SupplierPaymentAllocation_supplierBillId_fkey` FOREIGN KEY (`supplierBillId`) REFERENCES `SupplierBill`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `SupplierWithholding2307` ADD CONSTRAINT `SupplierWithholding2307_supplierBillId_fkey` FOREIGN KEY (`supplierBillId`) REFERENCES `SupplierBill`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `SupplierWithholding2307` ADD CONSTRAINT `SupplierWithholding2307_supplierPaymentId_fkey` FOREIGN KEY (`supplierPaymentId`) REFERENCES `SupplierPayment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `SupplierWithholding2307` ADD CONSTRAINT `SupplierWithholding2307_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `DocumentAttachment` ADD CONSTRAINT `DocumentAttachment_supplierPaymentId_fkey` FOREIGN KEY (`supplierPaymentId`) REFERENCES `SupplierPayment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `DocumentAttachment` ADD CONSTRAINT `DocumentAttachment_supplierWithholding2307Id_fkey` FOREIGN KEY (`supplierWithholding2307Id`) REFERENCES `SupplierWithholding2307`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
