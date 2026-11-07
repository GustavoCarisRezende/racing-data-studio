-- Existing imports retain their original date; restored copies carry the date
-- of the source data separately from the time at which the copy was created.
ALTER TABLE f1_imports ADD COLUMN source_imported_at TEXT;
