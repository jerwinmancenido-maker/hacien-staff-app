-- Audit A: sales orders close themselves when fully billed, paid and
-- delivered. Adds CLOSED to the status enum; no rows change (all existing
-- orders stay OPEN or VOID until a billing, collection or delivery change
-- recomputes them).
ALTER TABLE `SalesOrder` MODIFY `status` ENUM('OPEN', 'VOID', 'CLOSED') NOT NULL DEFAULT 'OPEN';
