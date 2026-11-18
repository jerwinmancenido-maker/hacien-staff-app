-- F5 (approval prompt model): quotes that trip no approval threshold are
-- NOT_REQUIRED. Enum value addition only.
-- NOTE: `prisma migrate dev` also detected pre-existing drift between
-- schema.prisma and the migration history (several foreign-key onDelete
-- behaviours and a DocumentVoid enum rewrite). That drift is NOT part of
-- this change and was trimmed out by hand — it needs its own scoped
-- migration if it is ever reconciled.
ALTER TABLE `Quote` MODIFY `approvalStatus` ENUM('PENDING', 'APPROVED', 'REJECTED', 'NOT_REQUIRED') NOT NULL DEFAULT 'PENDING';
