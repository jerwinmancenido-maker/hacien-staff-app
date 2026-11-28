-- Supplier payment requests (ERP adoption item 3, 2026-11-28): a
-- request-to-pay step in front of supplier payments. One request names
-- ONE supplier bill; lifecycle PENDING -> APPROVED / REJECTED -> PAID
-- (PAID set only by the supplier payment that settled it, linked via
-- supplierPaymentId). Additive only: one new table, no existing column
-- or row changes.

-- CreateTable
CREATE TABLE `SupplierPaymentRequest` (
    `id` VARCHAR(191) NOT NULL,
    `supplierBillId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `dueDate` DATE NOT NULL,
    `note` TEXT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'PAID', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `requestedById` VARCHAR(191) NOT NULL,
    `decidedById` VARCHAR(191) NULL,
    `decidedAt` DATETIME(3) NULL,
    `decisionNote` TEXT NULL,
    `supplierPaymentId` VARCHAR(191) NULL,
    `paidAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SupplierPaymentRequest_supplierBillId_idx`(`supplierBillId`),
    INDEX `SupplierPaymentRequest_status_idx`(`status`),
    INDEX `SupplierPaymentRequest_requestedById_idx`(`requestedById`),
    INDEX `SupplierPaymentRequest_dueDate_idx`(`dueDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `SupplierPaymentRequest` ADD CONSTRAINT `SupplierPaymentRequest_supplierBillId_fkey` FOREIGN KEY (`supplierBillId`) REFERENCES `SupplierBill`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `SupplierPaymentRequest` ADD CONSTRAINT `SupplierPaymentRequest_requestedById_fkey` FOREIGN KEY (`requestedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `SupplierPaymentRequest` ADD CONSTRAINT `SupplierPaymentRequest_decidedById_fkey` FOREIGN KEY (`decidedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `SupplierPaymentRequest` ADD CONSTRAINT `SupplierPaymentRequest_supplierPaymentId_fkey` FOREIGN KEY (`supplierPaymentId`) REFERENCES `SupplierPayment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
