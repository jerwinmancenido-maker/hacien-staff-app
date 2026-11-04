-- S-48: serial numbers on receiving lines and delivery (DR) lines. Additive only.
ALTER TABLE `ReceivingReportItem` ADD COLUMN `serialNumbers` TEXT NULL;
ALTER TABLE `DeliveryItem` ADD COLUMN `serialNumbers` TEXT NULL;
