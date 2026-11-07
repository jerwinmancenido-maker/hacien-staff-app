-- Item catalog, Step 3: link a quote line to its catalog item (null = a
-- free-text line, exactly as before). Additive column + FK only; no data
-- changes, existing lines keep null.
ALTER TABLE `QuoteItem` ADD COLUMN `itemId` VARCHAR(191) NULL;
ALTER TABLE `QuoteItem` ADD CONSTRAINT `QuoteItem_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX `QuoteItem_itemId_idx` ON `QuoteItem`(`itemId`);
