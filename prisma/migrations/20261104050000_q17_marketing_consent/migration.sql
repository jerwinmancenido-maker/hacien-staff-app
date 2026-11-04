-- Q17 S-96: per-contact marketing consent (email + SMS, OFF by default),
-- append-only consent history, and a permanent do-not-email suppression
-- table. Additive only: no column deleted or renamed. Existing contacts
-- get consent OFF via the column defaults (no backfill of consent ON).
ALTER TABLE `Contact` ADD COLUMN `marketingEmailConsent` BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE `Contact` ADD COLUMN `marketingSmsConsent` BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE `Contact` ADD COLUMN `emailUnsubscribeDueAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `MarketingConsentHistory` (
    `id` VARCHAR(191) NOT NULL,
    `contactId` VARCHAR(191) NOT NULL,
    `channel` ENUM('email', 'sms') NOT NULL,
    `consent` BOOLEAN NOT NULL,
    `source` VARCHAR(64) NOT NULL,
    `changedBy` VARCHAR(191) NOT NULL,
    `policyVersion` VARCHAR(20) NOT NULL,
    `ip` VARCHAR(64) NULL,
    `userAgent` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MarketingConsentHistory_contactId_createdAt_idx`(`contactId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmailSuppression` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `contactId` VARCHAR(191) NULL,
    `source` VARCHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `clearedAt` DATETIME(3) NULL,
    `clearedById` VARCHAR(191) NULL,

    INDEX `EmailSuppression_email_idx`(`email`),
    UNIQUE INDEX `EmailSuppression_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `MarketingConsentHistory` ADD CONSTRAINT `MarketingConsentHistory_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
