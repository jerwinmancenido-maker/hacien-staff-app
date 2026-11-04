-- S-70: quote sign-off — user position + signature image, and signed
-- conforme uploads saved on the quote. Additive only.
ALTER TABLE `User` ADD COLUMN `position` VARCHAR(120) NULL;
ALTER TABLE `User` ADD COLUMN `signatureStorageKey` VARCHAR(191) NULL;
ALTER TABLE `User` ADD COLUMN `signatureMimeType` VARCHAR(100) NULL;
ALTER TABLE `User` ADD COLUMN `signatureFileName` VARCHAR(255) NULL;
ALTER TABLE `DocumentAttachment` ADD COLUMN `quoteId` VARCHAR(191) NULL;
ALTER TABLE `DocumentAttachment` ADD INDEX `DocumentAttachment_quoteId_idx` (`quoteId`);
ALTER TABLE `DocumentAttachment` ADD CONSTRAINT `DocumentAttachment_quoteId_fkey` FOREIGN KEY (`quoteId`) REFERENCES `Quote`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
