-- CreateTable: SpoiledBookletNumber
CREATE TABLE `SpoiledBookletNumber` (
    `id` VARCHAR(191) NOT NULL,
    `type` ENUM('SI', 'DR', 'CR') NOT NULL,
    `number` INTEGER NOT NULL,
    `reason` TEXT NOT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `voidedAt` DATETIME(3) NULL,
    `voidReason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SpoiledBookletNumber_type_number_key`(`type`, `number`),
    INDEX `SpoiledBookletNumber_type_idx`(`type`),
    INDEX `SpoiledBookletNumber_number_idx`(`number`),
    INDEX `SpoiledBookletNumber_createdById_idx`(`createdById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable: DocumentAttachment (spoiledBookletNumberId)
ALTER TABLE `DocumentAttachment`
  ADD COLUMN `spoiledBookletNumberId` VARCHAR(191) NULL;

CREATE INDEX `DocumentAttachment_spoiledBookletNumberId_idx` ON `DocumentAttachment`(`spoiledBookletNumberId`);

-- AddForeignKey
ALTER TABLE `SpoiledBookletNumber` ADD CONSTRAINT `SpoiledBookletNumber_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DocumentAttachment` ADD CONSTRAINT `DocumentAttachment_spoiledBookletNumberId_fkey` FOREIGN KEY (`spoiledBookletNumberId`) REFERENCES `SpoiledBookletNumber`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
