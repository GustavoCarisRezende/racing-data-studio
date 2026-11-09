-- Analysis documents are independent of the immutable import snapshots.
CREATE TABLE f1_saved_analyses (
    id TEXT PRIMARY KEY NOT NULL,
    revision TEXT NOT NULL,
    document TEXT NOT NULL
);
