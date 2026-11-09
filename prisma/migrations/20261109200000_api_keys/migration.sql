-- /api/v1 keys, call log, and audit attribution.
-- Backfill: AuditLog.apiKeyId is added NULL. Every existing audit row stays
-- NULL, which means that change was not made through an API key. No row is
-- rewritten and no key is invented for old rows.

CREATE TABLE `ApiKey` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `keyPrefix` VARCHAR(16) NOT NULL,
    `keyHash` VARCHAR(64) NOT NULL,
    `scopes` JSON NOT NULL,
    `actingUserId` VARCHAR(191) NOT NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,
    `lastUsedAt` DATETIME(3) NULL,
    `lastUsedIp` VARCHAR(64) NULL,

    UNIQUE INDEX `ApiKey_keyHash_key`(`keyHash`),
    INDEX `ApiKey_keyPrefix_idx`(`keyPrefix`),
    INDEX `ApiKey_actingUserId_idx`(`actingUserId`),
    INDEX `ApiKey_createdById_idx`(`createdById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ApiCallLog` (
    `id` VARCHAR(191) NOT NULL,
    `apiKeyId` VARCHAR(191) NOT NULL,
    `method` VARCHAR(10) NOT NULL,
    `path` VARCHAR(255) NOT NULL,
    `status` INTEGER NOT NULL,
    `kind` VARCHAR(8) NOT NULL,
    `idempotencyKey` VARCHAR(191) NULL,
    `requestHash` VARCHAR(64) NULL,
    `responseJson` JSON NULL,
    `at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ApiCallLog_apiKeyId_kind_at_idx`(`apiKeyId`, `kind`, `at`),
    UNIQUE INDEX `ApiCallLog_apiKeyId_idempotencyKey_key`(`apiKeyId`, `idempotencyKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `AuditLog` ADD COLUMN `apiKeyId` VARCHAR(191) NULL;

CREATE INDEX `AuditLog_apiKeyId_idx` ON `AuditLog`(`apiKeyId`);

ALTER TABLE `ApiKey` ADD CONSTRAINT `ApiKey_actingUserId_fkey` FOREIGN KEY (`actingUserId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ApiKey` ADD CONSTRAINT `ApiKey_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `ApiCallLog` ADD CONSTRAINT `ApiCallLog_apiKeyId_fkey` FOREIGN KEY (`apiKeyId`) REFERENCES `ApiKey`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_apiKeyId_fkey` FOREIGN KEY (`apiKeyId`) REFERENCES `ApiKey`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
