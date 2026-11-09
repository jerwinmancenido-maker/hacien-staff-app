-- Lot (bundle) quote lines (2026-11-08): a lot line prints as one row
-- (description, qty "1 lot", one price) while its internal make-up — each
-- component a product with its own supplier and cost — lives in the new
-- QuoteItemComponent table. Additive only: existing lines are non-lot
-- (isLot defaults to false) and behave exactly as before.
ALTER TABLE `QuoteItem` ADD COLUMN `isLot` BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE `QuoteItemComponent` (
    `id` VARCHAR(191) NOT NULL,
    `quoteItemId` VARCHAR(191) NOT NULL,
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

    INDEX `QuoteItemComponent_quoteItemId_idx`(`quoteItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `QuoteItemComponent` ADD CONSTRAINT `QuoteItemComponent_quoteItemId_fkey` FOREIGN KEY (`quoteItemId`) REFERENCES `QuoteItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `QuoteItemComponent` ADD CONSTRAINT `QuoteItemComponent_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `QuoteItemComponent` ADD CONSTRAINT `QuoteItemComponent_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
