-- S-54: customer credit limit. Additive only.
ALTER TABLE `Customer` ADD COLUMN `creditLimit` DECIMAL(15, 2) NULL;
