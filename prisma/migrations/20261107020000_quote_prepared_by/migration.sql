-- Quote preparer picker (2026-11-07): optional preparer, null = the creator.
-- Existing quotes keep null and print the creator, exactly as before.
ALTER TABLE `Quote` ADD COLUMN `preparedById` VARCHAR(191) NULL;
ALTER TABLE `Quote` ADD CONSTRAINT `Quote_preparedById_fkey` FOREIGN KEY (`preparedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
