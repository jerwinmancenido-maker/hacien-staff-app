-- CreateTable
CREATE TABLE `MessageLog` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `channel` ENUM('sms', 'email') NOT NULL,
    `recipient` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `status` ENUM('sent', 'not_sent', 'failed') NOT NULL,
    `provider` VARCHAR(40) NOT NULL,
    `providerMessageId` VARCHAR(191) NULL,
    `error` TEXT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 1,
    `lastAttemptAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `sentById` VARCHAR(191) NULL,

    INDEX `MessageLog_channel_createdAt_idx`(`channel`, `createdAt`),
    INDEX `MessageLog_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
