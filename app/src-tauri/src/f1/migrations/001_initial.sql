-- Only the stable identity of a season is defined at this stage. Import status,
-- source records and results will be introduced with the importer migrations.
CREATE TABLE seasons (
    year INTEGER PRIMARY KEY CHECK (year > 0)
);
