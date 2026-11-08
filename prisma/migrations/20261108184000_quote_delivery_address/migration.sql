-- Quote delivery address pick (2026-11-08): a quote can carry one of the
-- customer's saved addresses; the text column snapshots it at save time.
-- Existing quotes keep null and behave exactly as before (the print and
-- the conversion fall back to the customer's suggested address).
ALTER TABLE `Quote` ADD COLUMN `deliveryAddressId` VARCHAR(191) NULL,
    ADD COLUMN `deliveryAddressText` TEXT NULL;
ALTER TABLE `Quote` ADD CONSTRAINT `Quote_deliveryAddressId_fkey` FOREIGN KEY (`deliveryAddressId`) REFERENCES `Address`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
