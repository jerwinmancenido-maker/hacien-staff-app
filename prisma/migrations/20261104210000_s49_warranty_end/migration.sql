-- S-49: supplier warranty end date per receiving line. Additive only.
ALTER TABLE `ReceivingReportItem` ADD COLUMN `warrantyEndDate` DATE NULL;
