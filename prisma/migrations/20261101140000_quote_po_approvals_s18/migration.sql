-- S-18: Quote workflow approval. Additive only (new enum/columns + backfill).
-- Backfill: DRAFT → PENDING; any non-draft → APPROVED with null approver fields
-- (no invented history). PO amount limit lives in Settings JSON (no PO columns).

ALTER TABLE `Quote`
  ADD COLUMN `approvalStatus` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  ADD COLUMN `approvedById` VARCHAR(191) NULL,
  ADD COLUMN `approvedAt` DATETIME(3) NULL,
  ADD COLUMN `rejectedById` VARCHAR(191) NULL,
  ADD COLUMN `rejectedAt` DATETIME(3) NULL,
  ADD COLUMN `rejectReason` TEXT NULL;

-- Backfill mapping (see src/lib/quotes/approval.ts quoteApprovalBackfill).
UPDATE `Quote` SET `approvalStatus` = 'PENDING' WHERE `status` = 'DRAFT';
UPDATE `Quote` SET `approvalStatus` = 'APPROVED', `approvedById` = NULL, `approvedAt` = NULL, `rejectedById` = NULL, `rejectedAt` = NULL, `rejectReason` = NULL WHERE `status` <> 'DRAFT';

CREATE INDEX `Quote_approvalStatus_idx` ON `Quote`(`approvalStatus`);

ALTER TABLE `Quote`
  ADD CONSTRAINT `Quote_approvedById_fkey` FOREIGN KEY (`approvedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `Quote_rejectedById_fkey` FOREIGN KEY (`rejectedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
