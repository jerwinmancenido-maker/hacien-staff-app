-- Statement "as of" math needs a business date per cash application.
-- Drop the unique pair so later credit applies can be separate dated rows
-- instead of merging into the original allocation's date.

ALTER TABLE `CollectionAllocation` DROP INDEX `CollectionAllocation_collectionId_billingId_key`;

ALTER TABLE `CollectionAllocation` ADD COLUMN `appliedOn` DATE NULL;

UPDATE `CollectionAllocation` ca
INNER JOIN `Collection` c ON c.`id` = ca.`collectionId`
SET ca.`appliedOn` = c.`date`;

ALTER TABLE `CollectionAllocation` MODIFY `appliedOn` DATE NOT NULL;

CREATE INDEX `CollectionAllocation_appliedOn_idx` ON `CollectionAllocation`(`appliedOn`);
