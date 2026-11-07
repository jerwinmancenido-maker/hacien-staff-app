-- Keep me signed in (2026-11-07): sessions can be remembered — 7-day idle, 30-day absolute cap.
-- Existing sessions keep false (today's behaviour: 30-minute idle, 7-day cap).
ALTER TABLE `Session` ADD COLUMN `rememberMe` BOOLEAN NOT NULL DEFAULT false;
