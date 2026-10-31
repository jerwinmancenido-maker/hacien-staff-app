-- Deploy gap: after 20261030220000, appliedOn is NOT NULL with no DEFAULT, so an
-- old app build that still inserts allocations without appliedOn would fail.
-- Expression default (MySQL 8.0.13+) covers that window; app code still passes
-- appliedOn explicitly. CURRENT_DATE / CURDATE() are synonyms here.
ALTER TABLE `CollectionAllocation`
  MODIFY `appliedOn` DATE NOT NULL DEFAULT (CURRENT_DATE);
