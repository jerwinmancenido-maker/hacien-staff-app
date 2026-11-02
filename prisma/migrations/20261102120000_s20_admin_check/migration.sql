-- S-20: staff-recorded billings and collections need an Admin check.
-- Additive only. Existing rows default to needsAdminCheck = false (they were
-- recorded by Admin or Approver). No money column is rewritten.
-- Do not run this on staging or live until a database backup is taken.

ALTER TABLE `Billing`
  ADD COLUMN `needsAdminCheck` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `adminCheckedAt` DATETIME(3) NULL,
  ADD COLUMN `adminCheckedById` VARCHAR(191) NULL;

ALTER TABLE `Collection`
  ADD COLUMN `needsAdminCheck` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `adminCheckedAt` DATETIME(3) NULL,
  ADD COLUMN `adminCheckedById` VARCHAR(191) NULL;

CREATE INDEX `Billing_needsAdminCheck_idx` ON `Billing`(`needsAdminCheck`);
CREATE INDEX `Collection_needsAdminCheck_idx` ON `Collection`(`needsAdminCheck`);

ALTER TABLE `Billing`
  ADD CONSTRAINT `Billing_adminCheckedById_fkey`
  FOREIGN KEY (`adminCheckedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `Collection`
  ADD CONSTRAINT `Collection_adminCheckedById_fkey`
  FOREIGN KEY (`adminCheckedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
