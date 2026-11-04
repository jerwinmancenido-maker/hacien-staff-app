-- S-56: personal reminders on deal records. Additive only.
CREATE TABLE `Reminder` (
  `id` VARCHAR(191) NOT NULL,
  `entityType` VARCHAR(20) NOT NULL,
  `entityId` VARCHAR(191) NOT NULL,
  `note` VARCHAR(500) NOT NULL,
  `remindAt` DATE NOT NULL,
  `createdById` VARCHAR(191) NOT NULL,
  `doneAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `Reminder_createdById_remindAt_idx` (`createdById`, `remindAt`),
  INDEX `Reminder_entityType_entityId_idx` (`entityType`, `entityId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
