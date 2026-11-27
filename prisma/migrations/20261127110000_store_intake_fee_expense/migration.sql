-- Online store intake, Gap 7 follow-up: a gateway fee withheld from
-- settlement is a real expense that never moved through a cash account,
-- so Expense.cashAccountId widens to nullable and a store-order
-- conversion can record the fee account-less. Widening only: every
-- existing row keeps its account; the FK and index are untouched.

-- AlterTable
ALTER TABLE `Expense` MODIFY `cashAccountId` VARCHAR(191) NULL;
