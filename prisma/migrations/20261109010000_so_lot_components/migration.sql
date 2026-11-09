-- Lot (bundle) lines carry into sales orders (2026-11-09, lot plan Phase B2):
-- conversion copies the quote lot's components into the new
-- SalesOrderItemComponent table, and Create POs buys the components — each
-- component PO line links back to its component with the same live-link
-- pattern SO lines already use (activeSalesOrderItemComponentId, unique,
-- cleared on PO void / line removal). Additive only: existing SO lines are
-- non-lot (isLot defaults to false) and behave exactly as before.
ALTER TABLE `SalesOrderItem` ADD COLUMN `isLot` BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE `SalesOrderItemComponent` (
    `id` VARCHAR(191) NOT NULL,
    `salesOrderItemId` VARCHAR(191) NOT NULL,
    `sortOrder` INTEGER NOT NULL,
    `itemId` VARCHAR(191) NULL,
    `description` TEXT NOT NULL,
    `qty` DECIMAL(12, 2) NOT NULL,
    `unit` VARCHAR(30) NOT NULL,
    `supplierId` VARCHAR(191) NULL,
    `unitCost` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `removedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SalesOrderItemComponent_salesOrderItemId_idx`(`salesOrderItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `SalesOrderItemComponent` ADD CONSTRAINT `SalesOrderItemComponent_salesOrderItemId_fkey` FOREIGN KEY (`salesOrderItemId`) REFERENCES `SalesOrderItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `SalesOrderItemComponent` ADD CONSTRAINT `SalesOrderItemComponent_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `SalesOrderItemComponent` ADD CONSTRAINT `SalesOrderItemComponent_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `PurchaseOrderItem` ADD COLUMN `salesOrderItemComponentId` VARCHAR(191) NULL;
ALTER TABLE `PurchaseOrderItem` ADD COLUMN `activeSalesOrderItemComponentId` VARCHAR(191) NULL;
CREATE INDEX `PurchaseOrderItem_salesOrderItemComponentId_idx` ON `PurchaseOrderItem`(`salesOrderItemComponentId`);
CREATE UNIQUE INDEX `PurchaseOrderItem_activeSalesOrderItemComponentId_key` ON `PurchaseOrderItem`(`activeSalesOrderItemComponentId`);
ALTER TABLE `PurchaseOrderItem` ADD CONSTRAINT `PurchaseOrderItem_salesOrderItemComponentId_fkey` FOREIGN KEY (`salesOrderItemComponentId`) REFERENCES `SalesOrderItemComponent`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
