-- AlterTable: SalesOrder (Government deal fields)
ALTER TABLE `SalesOrder`
  ADD COLUMN `philgepsRef` VARCHAR(64) NULL,
  ADD COLUMN `bidNo` VARCHAR(64) NULL,
  ADD COLUMN `noaDate` DATE NULL,
  ADD COLUMN `agencyPoNo` VARCHAR(64) NULL,
  ADD COLUMN `iarDate` DATE NULL;

-- AlterTable: SalesOrderItem (deliveredQty)
ALTER TABLE `SalesOrderItem`
  ADD COLUMN `deliveredQty` DECIMAL(12, 2) NOT NULL DEFAULT 0;

-- AlterTable: Billing (expectedDate)
ALTER TABLE `Billing`
  ADD COLUMN `expectedDate` DATE NULL;

-- CreateTable: Delivery
CREATE TABLE `Delivery` (
    `id` VARCHAR(191) NOT NULL,
    `salesOrderId` VARCHAR(191) NOT NULL,
    `drNumber` VARCHAR(64) NOT NULL,
    `deliveryDate` DATE NOT NULL,
    `receivedBy` VARCHAR(191) NULL,
    `receivedDate` DATE NULL,
    `idSightChecked` BOOLEAN NOT NULL DEFAULT false,
    `idCheckedById` VARCHAR(191) NULL,
    `idCheckedAt` DATETIME(3) NULL,
    `voidedAt` DATETIME(3) NULL,
    `voidReason` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Delivery_salesOrderId_idx`(`salesOrderId`),
    INDEX `Delivery_deliveryDate_idx`(`deliveryDate`),
    INDEX `Delivery_idCheckedById_idx`(`idCheckedById`),
    INDEX `Delivery_createdById_idx`(`createdById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: DeliveryItem
CREATE TABLE `DeliveryItem` (
    `id` VARCHAR(191) NOT NULL,
    `deliveryId` VARCHAR(191) NOT NULL,
    `salesOrderItemId` VARCHAR(191) NOT NULL,
    `qty` DECIMAL(12, 2) NOT NULL,
    `note` VARCHAR(255) NULL,

    INDEX `DeliveryItem_deliveryId_idx`(`deliveryId`),
    INDEX `DeliveryItem_salesOrderItemId_idx`(`salesOrderItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable: DocumentAttachment (deliveryId)
ALTER TABLE `DocumentAttachment`
  ADD COLUMN `deliveryId` VARCHAR(191) NULL;

CREATE INDEX `DocumentAttachment_deliveryId_idx` ON `DocumentAttachment`(`deliveryId`);

-- AddForeignKey
ALTER TABLE `Delivery` ADD CONSTRAINT `Delivery_salesOrderId_fkey` FOREIGN KEY (`salesOrderId`) REFERENCES `SalesOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Delivery` ADD CONSTRAINT `Delivery_idCheckedById_fkey` FOREIGN KEY (`idCheckedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Delivery` ADD CONSTRAINT `Delivery_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeliveryItem` ADD CONSTRAINT `DeliveryItem_deliveryId_fkey` FOREIGN KEY (`deliveryId`) REFERENCES `Delivery`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeliveryItem` ADD CONSTRAINT `DeliveryItem_salesOrderItemId_fkey` FOREIGN KEY (`salesOrderItemId`) REFERENCES `SalesOrderItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DocumentAttachment` ADD CONSTRAINT `DocumentAttachment_deliveryId_fkey` FOREIGN KEY (`deliveryId`) REFERENCES `Delivery`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
