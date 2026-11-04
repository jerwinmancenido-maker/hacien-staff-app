-- S-50: returns to supplier (RMA) with optional credit note. Additive only.
ALTER TABLE `DocumentSeries` MODIFY `docType` ENUM('QUOTE', 'SALES_ORDER', 'PURCHASE_ORDER', 'RECEIVING_REPORT', 'SUPPLIER_BILL', 'BILLING', 'COLLECTION', 'SUPPLIER_PAYMENT', 'EXPENSE', 'CASH_TRANSFER', 'SUPPLIER_RETURN') NOT NULL;
ALTER TABLE `DocumentVoid` MODIFY `docType` ENUM('QUOTE', 'SALES_ORDER', 'PURCHASE_ORDER', 'RECEIVING_REPORT', 'SUPPLIER_BILL', 'BILLING', 'COLLECTION', 'SUPPLIER_PAYMENT', 'EXPENSE', 'CASH_TRANSFER', 'SUPPLIER_RETURN') NOT NULL;
CREATE TABLE `SupplierReturn` (
  `id` VARCHAR(191) NOT NULL,
  `number` VARCHAR(40) NOT NULL,
  `purchaseOrderId` VARCHAR(191) NOT NULL,
  `returnDate` DATE NOT NULL,
  `reason` TEXT NULL,
  `creditNoteNumber` VARCHAR(64) NULL,
  `creditNoteAmount` DECIMAL(15, 2) NULL,
  `status` ENUM('POSTED', 'VOID') NOT NULL DEFAULT 'POSTED',
  `voidedAt` DATETIME(3) NULL,
  `voidReason` TEXT NULL,
  `createdById` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `SupplierReturn_number_key` (`number`),
  INDEX `SupplierReturn_purchaseOrderId_idx` (`purchaseOrderId`),
  INDEX `SupplierReturn_status_idx` (`status`),
  INDEX `SupplierReturn_returnDate_idx` (`returnDate`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `SupplierReturnItem` (
  `id` VARCHAR(191) NOT NULL,
  `purchaseOrderItemId` VARCHAR(191) NOT NULL,
  `supplierReturnId` VARCHAR(191) NOT NULL,
  `qtyReturned` DECIMAL(12, 2) NOT NULL,
  INDEX `SupplierReturnItem_supplierReturnId_idx` (`supplierReturnId`),
  INDEX `SupplierReturnItem_purchaseOrderItemId_idx` (`purchaseOrderItemId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `SupplierReturn` ADD CONSTRAINT `SupplierReturn_purchaseOrderId_fkey` FOREIGN KEY (`purchaseOrderId`) REFERENCES `PurchaseOrder` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `SupplierReturn` ADD CONSTRAINT `SupplierReturn_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `SupplierReturnItem` ADD CONSTRAINT `SupplierReturnItem_supplierReturnId_fkey` FOREIGN KEY (`supplierReturnId`) REFERENCES `SupplierReturn` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `SupplierReturnItem` ADD CONSTRAINT `SupplierReturnItem_purchaseOrderItemId_fkey` FOREIGN KEY (`purchaseOrderItemId`) REFERENCES `PurchaseOrderItem` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
