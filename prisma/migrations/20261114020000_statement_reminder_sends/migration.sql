-- Phase 3 #9: statement/payment reminder sends. Additive only: one new
-- table, and one AuditAction enum value appended at the end (existing
-- rows keep their values). No backfill — the table starts empty and old
-- code runs against the new schema unchanged (rollback = redeploy old
-- build; the extra table/enum value are inert for it).

CREATE TABLE `StatementReminderSend` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `recipient` VARCHAR(191) NOT NULL,
    `periodFrom` DATETIME(3) NULL,
    `periodTo` DATETIME(3) NULL,
    `closingBalance` DECIMAL(15, 2) NOT NULL,
    `sentById` VARCHAR(191) NOT NULL,
    `sentAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `StatementReminderSend_customerId_sentAt_idx`(`customerId`, `sentAt`),
    INDEX `StatementReminderSend_recipient_sentAt_idx`(`recipient`, `sentAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `StatementReminderSend` ADD CONSTRAINT `StatementReminderSend_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `AuditLog` MODIFY `action` ENUM('create', 'update', 'archive', 'restore', 'void', 'login', 'login_failed', 'login_2fa_pending', 'settings_change', 'email_draft', 'download', 'delete', 'send_email') NOT NULL;
