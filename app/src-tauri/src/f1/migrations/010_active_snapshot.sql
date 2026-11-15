-- The active source can be an older immutable snapshot; latest remains MAX(id).
CREATE TABLE f1_active_snapshots (
    season_year INTEGER PRIMARY KEY NOT NULL REFERENCES seasons(year) ON DELETE CASCADE,
    snapshot_id INTEGER NOT NULL UNIQUE REFERENCES f1_imports(id) ON DELETE CASCADE
);

INSERT INTO f1_active_snapshots(season_year, snapshot_id)
SELECT season_year, MAX(id) FROM f1_imports GROUP BY season_year;
