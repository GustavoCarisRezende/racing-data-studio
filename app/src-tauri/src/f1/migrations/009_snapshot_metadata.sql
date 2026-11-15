-- Snapshot labels are independent metadata; source imports and saved documents remain untouched.
CREATE TABLE IF NOT EXISTS f1_snapshot_metadata (
    snapshot_id INTEGER PRIMARY KEY NOT NULL REFERENCES f1_imports(id) ON DELETE CASCADE,
    season_year INTEGER NOT NULL,
    name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
    normalized_name TEXT NOT NULL,
    UNIQUE(season_year, normalized_name)
);
