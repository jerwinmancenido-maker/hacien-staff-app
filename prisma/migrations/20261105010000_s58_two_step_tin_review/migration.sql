-- S-58: two-step sign-in secret + access review log. Additive only.
ALTER TABLE `User` ADD COLUMN `totpSecret` VARCHAR(255) NULL;
CREATE TABLE `AccessReview` (
  `id` VARCHAR(191) NOT NULL,
  `reviewedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `reviewedById` VARCHAR(191) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `AccessReview_reviewedAt_idx` (`reviewedAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `AuditLog` MODIFY `action` ENUM('create', 'update', 'archive', 'restore', 'void', 'login', 'login_failed', 'login_2fa_pending', 'settings_change', 'email_draft', 'download') NOT NULL;
