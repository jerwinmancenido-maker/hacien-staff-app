-- Online store intake, Slice 1 (Online Store plan rev 4). Additive only:
-- two new tables (StoreOrder, StoreOrderLine), STORE_ORDER added to the
-- DocType enum (DocumentSeries + DocumentVoid share it), GATEWAY added to
-- CollectionMethod, and a plain index on Item.sku for SKU matching.
-- No existing column or row changes; no backfill.

-- AlterTable
ALTER TABLE `DocumentSeries` MODIFY `docType` ENUM('QUOTE', 'SALES_ORDER', 'PURCHASE_ORDER', 'RECEIVING_REPORT', 'SUPPLIER_BILL', 'BILLING', 'COLLECTION', 'SUPPLIER_PAYMENT', 'EXPENSE', 'CASH_TRANSFER', 'SUPPLIER_RETURN', 'CUSTOMER_RETURN', 'STORE_ORDER') NOT NULL;

-- AlterTable
ALTER TABLE `DocumentVoid` MODIFY `docType` ENUM('QUOTE', 'SALES_ORDER', 'PURCHASE_ORDER', 'RECEIVING_REPORT', 'SUPPLIER_BILL', 'BILLING', 'COLLECTION', 'SUPPLIER_PAYMENT', 'EXPENSE', 'CASH_TRANSFER', 'SUPPLIER_RETURN', 'CUSTOMER_RETURN', 'STORE_ORDER') NOT NULL;

-- AlterTable
ALTER TABLE `Collection` MODIFY `method` ENUM('CASH', 'CHECK', 'BANK_TRANSFER', 'GCASH', 'GATEWAY') NOT NULL;

-- CreateTable
CREATE TABLE `StoreOrder` (
    `id` VARCHAR(191) NOT NULL,
    `number` VARCHAR(40) NOT NULL,
    `status` ENUM('PAID', 'CONFIRMED', 'PROVISIONING', 'REFUNDED', 'CHARGEBACK') NOT NULL DEFAULT 'PAID',
    `gatewayName` VARCHAR(100) NOT NULL,
    `gatewayPaymentRef` VARCHAR(191) NOT NULL,
    `gatewayPaymentKey` VARCHAR(191) NOT NULL,
    `amountPaid` DECIMAL(15, 2) NOT NULL,
    `gatewayFee` DECIMAL(15, 2) NOT NULL,
    `deliveryFee` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'PHP',
    `buyerName` VARCHAR(191) NOT NULL,
    `buyerEmail` VARCHAR(191) NOT NULL,
    `buyerPhone` VARCHAR(64) NOT NULL,
    `addressLabel` VARCHAR(100) NULL,
    `addressStreet` TEXT NOT NULL,
    `addressBarangay` VARCHAR(120) NOT NULL DEFAULT '',
    `addressCityMunicipality` VARCHAR(120) NOT NULL DEFAULT '',
    `addressProvince` VARCHAR(120) NOT NULL DEFAULT '',
    `addressZip` VARCHAR(4) NOT NULL DEFAULT '',
    `buyerNotes` TEXT NULL,
    `paidAt` DATETIME(3) NOT NULL,
    `matchedCustomerId` VARCHAR(191) NULL,
    `matchedContactId` VARCHAR(191) NULL,
    `salesOrderId` VARCHAR(191) NULL,
    `convertedById` VARCHAR(191) NULL,
    `convertedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `StoreOrder_number_key`(`number`),
    UNIQUE INDEX `StoreOrder_gatewayPaymentKey_key`(`gatewayPaymentKey`),
    UNIQUE INDEX `StoreOrder_salesOrderId_key`(`salesOrderId`),
    INDEX `StoreOrder_status_idx`(`status`),
    INDEX `StoreOrder_matchedCustomerId_idx`(`matchedCustomerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StoreOrderLine` (
    `id` VARCHAR(191) NOT NULL,
    `storeOrderId` VARCHAR(191) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `sku` VARCHAR(60) NULL,
    `itemId` VARCHAR(191) NULL,
    `matchFlag` ENUM('MAPPED', 'NO_MATCH', 'AMBIGUOUS') NOT NULL,
    `title` TEXT NOT NULL,
    `qty` DECIMAL(12, 2) NOT NULL,
    `unit` VARCHAR(30) NOT NULL,
    `unitPrice` DECIMAL(15, 2) NOT NULL,
    `lineTotal` DECIMAL(15, 2) NOT NULL,
    `termEndDate` DATE NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `StoreOrderLine_storeOrderId_idx`(`storeOrderId`),
    INDEX `StoreOrderLine_itemId_idx`(`itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Item_sku_idx` ON `Item`(`sku`);

-- AddForeignKey
ALTER TABLE `StoreOrder` ADD CONSTRAINT `StoreOrder_matchedCustomerId_fkey` FOREIGN KEY (`matchedCustomerId`) REFERENCES `Customer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StoreOrder` ADD CONSTRAINT `StoreOrder_matchedContactId_fkey` FOREIGN KEY (`matchedContactId`) REFERENCES `Contact`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StoreOrder` ADD CONSTRAINT `StoreOrder_salesOrderId_fkey` FOREIGN KEY (`salesOrderId`) REFERENCES `SalesOrder`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StoreOrder` ADD CONSTRAINT `StoreOrder_convertedById_fkey` FOREIGN KEY (`convertedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StoreOrderLine` ADD CONSTRAINT `StoreOrderLine_storeOrderId_fkey` FOREIGN KEY (`storeOrderId`) REFERENCES `StoreOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StoreOrderLine` ADD CONSTRAINT `StoreOrderLine_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

