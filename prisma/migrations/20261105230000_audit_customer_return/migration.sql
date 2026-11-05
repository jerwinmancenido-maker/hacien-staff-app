-- Audit D: customer return / credit memo. New tables only; no existing
-- table changes. A credit memo is not a Collection (money never moved),
-- so it has its own ledger: CustomerCredit holds the returned value,
-- CustomerCreditApplication records what was applied to a billing.
-- Also adds CUSTOMER_RETURN to the document-number series enum.
ALTER TABLE `DocumentSeries` MODIFY `docType` ENUM('QUOTE', 'SALES_ORDER', 'PURCHASE_ORDER', 'RECEIVING_REPORT', 'SUPPLIER_BILL', 'BILLING', 'COLLECTION', 'SUPPLIER_PAYMENT', 'EXPENSE', 'CASH_TRANSFER', 'SUPPLIER_RETURN', 'CUSTOMER_RETURN') NOT NULL;
CREATE TABLE `CustomerReturn` (
    `id` VARCHAR(191) NOT NULL,
    `number` VARCHAR(40) NOT NULL,
    `salesOrderId` VARCHAR(191) NOT NULL,
    `returnDate` DATE NOT NULL,
    `reason` TEXT NULL,
    `status` ENUM('POSTED', 'VOID') NOT NULL DEFAULT 'POSTED',
    `voidedAt` DATETIME(3) NULL,
    `voidReason` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CustomerReturn_number_key`(`number`),
    INDEX `CustomerReturn_salesOrderId_idx`(`salesOrderId`),
    INDEX `CustomerReturn_status_idx`(`status`),
    INDEX `CustomerReturn_returnDate_idx`(`returnDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CustomerReturnItem` (
    `id` VARCHAR(191) NOT NULL,
    `customerReturnId` VARCHAR(191) NOT NULL,
    `salesOrderItemId` VARCHAR(191) NOT NULL,
    `qtyReturned` DECIMAL(12, 2) NOT NULL,
    `unitPrice` DECIMAL(15, 2) NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL,

    INDEX `CustomerReturnItem_customerReturnId_idx`(`customerReturnId`),
    INDEX `CustomerReturnItem_salesOrderItemId_idx`(`salesOrderItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CustomerCredit` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `customerReturnId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CustomerCredit_customerReturnId_key`(`customerReturnId`),
    INDEX `CustomerCredit_customerId_idx`(`customerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CustomerCreditApplication` (
    `id` VARCHAR(191) NOT NULL,
    `customerCreditId` VARCHAR(191) NOT NULL,
    `billingId` VARCHAR(191) NOT NULL,
    `cashApplied` DECIMAL(15, 2) NOT NULL,
    `appliedOn` DATE NOT NULL DEFAULT (curdate()),

    INDEX `CustomerCreditApplication_customerCreditId_idx`(`customerCreditId`),
    INDEX `CustomerCreditApplication_billingId_idx`(`billingId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `CustomerReturn` ADD CONSTRAINT `CustomerReturn_salesOrderId_fkey` FOREIGN KEY (`salesOrderId`) REFERENCES `SalesOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `CustomerReturn` ADD CONSTRAINT `CustomerReturn_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `CustomerReturnItem` ADD CONSTRAINT `CustomerReturnItem_customerReturnId_fkey` FOREIGN KEY (`customerReturnId`) REFERENCES `CustomerReturn`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `CustomerReturnItem` ADD CONSTRAINT `CustomerReturnItem_salesOrderItemId_fkey` FOREIGN KEY (`salesOrderItemId`) REFERENCES `SalesOrderItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `CustomerCredit` ADD CONSTRAINT `CustomerCredit_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `CustomerCredit` ADD CONSTRAINT `CustomerCredit_customerReturnId_fkey` FOREIGN KEY (`customerReturnId`) REFERENCES `CustomerReturn`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `CustomerCredit` ADD CONSTRAINT `CustomerCredit_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `CustomerCreditApplication` ADD CONSTRAINT `CustomerCreditApplication_customerCreditId_fkey` FOREIGN KEY (`customerCreditId`) REFERENCES `CustomerCredit`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `CustomerCreditApplication` ADD CONSTRAINT `CustomerCreditApplication_billingId_fkey` FOREIGN KEY (`billingId`) REFERENCES `Billing`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
