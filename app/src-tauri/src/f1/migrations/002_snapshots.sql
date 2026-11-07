-- Immutable source snapshots: a failed or incomplete refresh cannot erase prior data.
CREATE TABLE f1_imports (
    id INTEGER PRIMARY KEY,
    season_year INTEGER NOT NULL REFERENCES seasons(year),
    imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE f1_import_pages (
    import_id INTEGER NOT NULL REFERENCES f1_imports(id),
    endpoint TEXT NOT NULL CHECK(endpoint IN ('races','results','sprint')),
    page_offset INTEGER NOT NULL CHECK(page_offset >= 0),
    payload TEXT NOT NULL,
    PRIMARY KEY(import_id, endpoint, page_offset)
);
