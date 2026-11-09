//! F1 owns this database and its migrations; no shared motorsport schema.
use rusqlite::{Connection, OptionalExtension, TransactionBehavior};
use std::{error::Error, fs, path::Path};
use std::collections::BTreeMap;

type Result<T> = std::result::Result<T, Box<dyn Error>>;
const SCHEMA_VERSION: i64 = 4;

pub struct F1Repository {
    // Future F1 queries and transactional writes belong here, never in the shell.
    connection: Connection,
}

impl F1Repository {
    pub fn open(app_data_dir: &Path) -> Result<Self> {
        let category_dir = app_data_dir.join("categories");
        fs::create_dir_all(&category_dir)?;
        let mut connection = Connection::open(category_dir.join("f1.sqlite"))?;
        migrate(&mut connection)?;
        Ok(Self { connection })
    }

    pub fn save(&mut self, year: u16, pages: &[super::jolpica::Page]) -> Result<()> {
        let coverage = super::jolpica::validate_pages(year, pages)?;
        let tx = self.connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        // Avoid creating another snapshot when the latest one is byte-for-byte identical.
        let previous: Option<i64> = tx.query_row("SELECT id FROM f1_imports WHERE season_year = ?1 ORDER BY id DESC LIMIT 1", [year], |r| r.get(0)).optional()?;
        if let Some(id) = previous {
            let mut stmt = tx.prepare("SELECT endpoint, page_offset, payload FROM f1_import_pages WHERE import_id = ?1 ORDER BY endpoint, page_offset")?;
            let rows = stmt.query_map([id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?)))?.collect::<std::result::Result<Vec<_>, _>>()?;
            let mut incoming: Vec<_> = pages.iter().map(|p| (p.endpoint.to_owned(), p.offset as i64, p.payload.clone())).collect();
            incoming.sort();
            if rows == incoming { return Ok(()); }
            let mut old_pages = Vec::new();
            for (endpoint, offset, payload) in rows {
                let endpoint = match endpoint.as_str() {
                    "races" => "races", "results" => "results", "sprint" => "sprint",
                    _ => return Err("Invalid endpoint in previous snapshot; update refused".into()),
                };
                let offset = usize::try_from(offset).map_err(|_| "Invalid offset in previous snapshot")?;
                old_pages.push(super::jolpica::Page { endpoint, offset, payload });
            }
            let previous = super::jolpica::validate_pages(year, &old_pages)
                .map_err(|e| format!("Cannot validate previous snapshot; update refused: {e}"))?;
            coverage.check_not_reduced(&previous)?;
        }
        tx.execute("INSERT OR IGNORE INTO seasons(year) VALUES (?1)", [year])?;
        tx.execute("INSERT INTO f1_imports(season_year) VALUES (?1)", [year])?;
        let id = tx.last_insert_rowid();
        for page in pages {
            tx.execute("INSERT INTO f1_import_pages(import_id, endpoint, page_offset, payload) VALUES (?1, ?2, ?3, ?4)", rusqlite::params![id, page.endpoint, page.offset as i64, page.payload])?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn list(&self) -> Result<Vec<serde_json::Value>> {
        let mut stmt = self.connection.prepare("SELECT s.year, (SELECT imported_at FROM f1_imports WHERE season_year = s.year ORDER BY id DESC LIMIT 1), (SELECT COALESCE(source_imported_at, imported_at) FROM f1_imports WHERE season_year = s.year ORDER BY id DESC LIMIT 1) FROM seasons s ORDER BY s.year DESC")?;
        let rows = stmt.query_map([], |r| Ok(serde_json::json!({"year": r.get::<_, i64>(0)?, "importedAt": r.get::<_, Option<String>>(1)?, "dataAt":r.get::<_, Option<String>>(2)?})))?.collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Freeze the latest snapshot of each local season in one SQLite read transaction.
    /// This read-only projection is bounded before it crosses IPC.
    pub fn analysis_snapshots(&mut self) -> Result<Vec<serde_json::Value>> {
        self.analysis_snapshots_for(None)
    }

    pub fn analysis_snapshots_for(&mut self, revisions: Option<Vec<super::saved_analysis::Revision>>) -> Result<Vec<serde_json::Value>> {
        let tx = self.connection.transaction()?;
        let imports = if let Some(revisions) = revisions {
            if revisions.is_empty() || revisions.len() > 151 { return Err("Invalid revisions".into()); }
            let mut seen = std::collections::HashSet::new();
            let mut imports = Vec::new();
            super::saved_analysis::check_revisions(&tx, &revisions).map_err(|e| -> Box<dyn Error> { e.into() })?;
            for r in revisions {
                let year: u16 = r.partition_id.parse()?;
                let id: i64 = r.revision_id.parse()?;
                if !(1950..=2100).contains(&year) || year.to_string() != r.partition_id || id <= 0 || id.to_string() != r.revision_id || !seen.insert(year) { return Err("Invalid revision".into()); }
                imports.push((id, year, r.stored_at, r.source_data_at.ok_or("Missing source timestamp")?));
            }
            imports
        } else {
            let mut stmt = tx.prepare("SELECT id, season_year, imported_at, COALESCE(source_imported_at, imported_at) FROM f1_imports i WHERE id = (SELECT MAX(id) FROM f1_imports WHERE season_year = i.season_year) ORDER BY season_year")?;
            let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, u16>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?)))?;
            rows.collect::<std::result::Result<Vec<_>, _>>()?
        };
        if imports.len() > 151 { return Err("Too many seasons".into()); }
        let mut total = 0usize;
        let mut snapshots = Vec::new();
        for (id, year, stored_at, source_at) in imports {
            if id <= 0 || !(1950..=2100).contains(&year) { return Err("Invalid stored snapshot identity".into()); }
            let mut pages = Vec::new();
            {
                let mut stmt = tx.prepare("SELECT endpoint, page_offset, payload FROM f1_import_pages WHERE import_id = ?1 ORDER BY endpoint, page_offset")?;
                let mut rows = stmt.query([id])?;
                while let Some(row) = rows.next()? {
                    let name: String = row.get(0)?;
                    let endpoint = match name.as_str() { "races" => "races", "results" => "results", "sprint" => "sprint", _ => return Err("Invalid endpoint".into()) };
                    let payload: String = row.get(2)?;
                    total = total.checked_add(payload.len()).ok_or("Snapshot size overflow")?;
                    if total > 64 * 1024 * 1024 { return Err("Analysis snapshot size limit exceeded".into()); }
                    pages.push(super::jolpica::Page { endpoint, offset: usize::try_from(row.get::<_, i64>(1)?)?, payload });
                }
            }
            super::jolpica::validate_pages(year, &pages).map_err(|e| format!("Invalid analysis snapshot: {e}"))?;
            let mut results = Vec::new();
            for page in pages.iter().filter(|p| p.endpoint != "races") {
                let root: serde_json::Value = serde_json::from_str(&page.payload)?;
                let races = root.pointer("/MRData/RaceTable/Races").and_then(serde_json::Value::as_array).ok_or("Invalid results")?;
                for race in races {
                    let key = if page.endpoint == "results" { "Results" } else { "SprintResults" };
                    for result in race.get(key).and_then(serde_json::Value::as_array).ok_or("Invalid results")? {
                        results.push(serde_json::json!({"round": race["round"], "session": page.endpoint, "result": result}));
                        if results.len() > 100_000 { return Err("Too many result occurrences".into()); }
                    }
                }
            }
            snapshots.push(serde_json::json!({"year": year, "id": id.to_string(), "storedAt": stored_at, "sourceDataAt": source_at, "results": results}));
        }
        tx.commit()?;
        Ok(snapshots)
    }

    pub fn saved_list(&self) -> std::result::Result<Vec<serde_json::Value>, String> { super::saved_analysis::list(&self.connection) }
    pub fn saved_load(&self, id: &str) -> std::result::Result<serde_json::Value, String> { super::saved_analysis::load(&self.connection, id) }
    pub fn saved_save(&mut self, document: serde_json::Value, expected: Option<String>) -> std::result::Result<serde_json::Value, String> { super::saved_analysis::save(&mut self.connection, document, expected) }

    pub fn snapshots(&self, year: u16) -> Result<Vec<serde_json::Value>> {
        let mut stmt = self.connection.prepare("SELECT id, imported_at, COALESCE(source_imported_at, imported_at) FROM f1_imports WHERE season_year = ?1 ORDER BY id DESC")?;
        let rows = stmt.query_map([year], |r| Ok(serde_json::json!({"id":r.get::<_, i64>(0)?, "importedAt":r.get::<_, String>(1)?, "dataAt":r.get::<_, String>(2)?})))?.collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Build per-event projections from one consistent SQLite read transaction.
    /// The original pages remain the authoritative, lossless season snapshot.
    pub fn event_archives(&mut self, year: u16, id: i64) -> Result<Vec<super::event_archive::EventArchive>> {
        if !(1950..=2100).contains(&year) || id <= 0 { return Err("Invalid season or snapshot ID".into()); }
        let tx = self.connection.transaction()?;
        let (saved_at, source_at): (String, String) = tx.query_row(
            "SELECT imported_at, COALESCE(source_imported_at, imported_at) FROM f1_imports WHERE id = ?1 AND season_year = ?2",
            rusqlite::params![id, year], |r| Ok((r.get(0)?, r.get(1)?)))?;
        let mut pages = Vec::new();
        {
            let mut stmt = tx.prepare("SELECT endpoint, page_offset, payload FROM f1_import_pages WHERE import_id = ?1 ORDER BY endpoint, page_offset")?;
            let mut rows = stmt.query([id])?;
            while let Some(row) = rows.next()? {
                let name: String = row.get(0)?;
                let endpoint = match name.as_str() { "races" => "races", "results" => "results", "sprint" => "sprint", _ => return Err("Invalid endpoint".into()) };
                let offset: i64 = row.get(1)?;
                pages.push(super::jolpica::Page { endpoint, offset: usize::try_from(offset)?, payload: row.get(2)? });
            }
        }
        super::jolpica::validate_pages(year, &pages).map_err(|e| format!("Invalid source snapshot: {e}"))?;
        let mut events: BTreeMap<u16, serde_json::Value> = BTreeMap::new();
        for page in &pages {
            let root: serde_json::Value = serde_json::from_str(&page.payload)?;
            let races = root.pointer("/MRData/RaceTable/Races").and_then(serde_json::Value::as_array).ok_or("Invalid races")?;
            for race in races {
                let round: u16 = race["round"].as_str().ok_or("Invalid round")?.parse()?;
                if round == 0 { return Err("Invalid round".into()); }
                if page.endpoint == "races" {
                    events.insert(round, serde_json::json!({"format":"rds-f1-event-v1", "season":year, "round":round, "snapshot_id":id, "saved_at":saved_at, "source_data_at":source_at, "calendar":race, "race_fragments":[], "sprint_fragments":[]}));
                } else {
                    let event = events.get_mut(&round).ok_or("Result absent from calendar")?;
                    let key = if page.endpoint == "results" { "race_fragments" } else { "sprint_fragments" };
                    event[key].as_array_mut().ok_or("Invalid event projection")?.push(race.clone());
                }
            }
        }
        tx.commit()?;
        Ok(events.into_iter().map(|(round, payload)| super::event_archive::EventArchive { year, round, snapshot_id: id, payload }).collect())
    }

    /// Restore by appending an independently validated copy, never changing the source.
    pub fn restore(&mut self, year: u16, id: i64) -> Result<()> {
        if id <= 0 { return Err("Invalid snapshot ID".into()); }
        let tx = self.connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let source_at: Option<String> = tx.query_row("SELECT COALESCE(source_imported_at, imported_at) FROM f1_imports WHERE id = ?1 AND season_year = ?2", rusqlite::params![id, year], |r| r.get(0)).optional()?;
        let source_at = source_at.ok_or("Snapshot not found for season")?;
        let mut pages = Vec::new();
        {
            let mut stmt = tx.prepare("SELECT endpoint, page_offset, payload FROM f1_import_pages WHERE import_id = ?1 ORDER BY endpoint, page_offset")?;
            let mut rows = stmt.query([id])?;
            while let Some(row) = rows.next()? {
                let name: String = row.get(0)?;
                let endpoint = match name.as_str() { "races" => "races", "results" => "results", "sprint" => "sprint", _ => return Err("Invalid snapshot endpoint".into()) };
                let offset: i64 = row.get(1)?;
                pages.push(super::jolpica::Page { endpoint, offset: usize::try_from(offset)?, payload: row.get(2)? });
            }
        }
        super::jolpica::validate_pages(year, &pages).map_err(|e| format!("Invalid snapshot: {e}"))?;
        let latest: Option<i64> = tx.query_row("SELECT id FROM f1_imports WHERE season_year = ?1 ORDER BY id DESC LIMIT 1", [year], |r| r.get(0)).optional()?;
        if latest == Some(id) { return Ok(()); }
        tx.execute("INSERT INTO f1_imports(season_year, source_imported_at) VALUES (?1, ?2)", rusqlite::params![year, source_at])?;
        let new_id = tx.last_insert_rowid();
        for page in pages {
            tx.execute("INSERT INTO f1_import_pages(import_id, endpoint, page_offset, payload) VALUES (?1, ?2, ?3, ?4)", rusqlite::params![new_id, page.endpoint, page.offset as i64, page.payload])?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Read the latest immutable source snapshot, without relying on network.
    pub fn details(&self, year: u16) -> Result<serde_json::Value> {
        let id: i64 = self.connection.query_row("SELECT id FROM f1_imports WHERE season_year = ?1 ORDER BY id DESC LIMIT 1", [year], |r| r.get(0))?;
        let mut stmt = self.connection.prepare("SELECT endpoint, payload FROM f1_import_pages WHERE import_id = ?1 ORDER BY endpoint, page_offset")?;
        let rows = stmt.query_map([id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        let mut calendar = Vec::new();
        let mut results = Vec::new();
        for row in rows {
            let (endpoint, payload) = row?;
            let root: serde_json::Value = serde_json::from_str(&payload)?;
            let races = root.pointer("/MRData/RaceTable/Races").and_then(serde_json::Value::as_array).ok_or("Invalid stored snapshot")?;
            for race in races {
                if endpoint == "races" { calendar.push(race.clone()); }
                else {
                    let key = if endpoint == "results" { "Results" } else if endpoint == "sprint" { "SprintResults" } else { return Err("Invalid stored endpoint".into()); };
                    for result in race.get(key).and_then(serde_json::Value::as_array).ok_or("Invalid stored results")? {
                        results.push(serde_json::json!({"round":race["round"], "type":endpoint, "result":result}));
                    }
                }
            }
        }
        Ok(serde_json::json!({"calendar": calendar, "results": results}))
    }
}

fn migrate(connection: &mut Connection) -> Result<()> {
    connection.execute_batch("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;")?;
    let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let version: i64 = tx.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version > SCHEMA_VERSION {
        return Err(format!("F1 database schema version {version} is newer than supported version {SCHEMA_VERSION}").into());
    }
    if version < 1 {
        tx.execute_batch(include_str!("migrations/001_initial.sql"))?;
        tx.pragma_update(None, "user_version", 1)?;
    }
    if version < 2 {
        tx.execute_batch(include_str!("migrations/002_snapshots.sql"))?;
        tx.pragma_update(None, "user_version", 2)?;
    }
    if version < 3 {
        tx.execute_batch(include_str!("migrations/003_restore_provenance.sql"))?;
        tx.pragma_update(None, "user_version", 3)?;
    }
    if version < 4 {
        tx.execute_batch(include_str!("migrations/004_saved_analyses.sql"))?;
        tx.pragma_update(None, "user_version", 4)?;
    }
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migration_is_idempotent_and_preserves_data() {
        let mut db = Connection::open_in_memory().unwrap();
        db.execute_batch(include_str!("migrations/001_initial.sql")).unwrap();
        db.pragma_update(None, "user_version", 1).unwrap();
        db.execute("INSERT INTO seasons (year) VALUES (2024)", []).unwrap();
        migrate(&mut db).unwrap();
        migrate(&mut db).unwrap();
        assert_eq!(db.query_row("SELECT year FROM seasons", [], |r| r.get::<_, i64>(0)).unwrap(), 2024);
        assert_eq!(db.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0)).unwrap(), 4);
    }

    #[test]
    fn newer_schema_is_rejected_without_changes() {
        let mut db = Connection::open_in_memory().unwrap();
        db.pragma_update(None, "user_version", 99).unwrap();
        assert!(migrate(&mut db).is_err());
        assert_eq!(db.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0)).unwrap(), 99);
    }

    #[test]
    fn version_two_imports_survive_provenance_migration() {
        let mut db = Connection::open_in_memory().unwrap();
        db.execute_batch(include_str!("migrations/001_initial.sql")).unwrap();
        db.execute_batch(include_str!("migrations/002_snapshots.sql")).unwrap();
        db.pragma_update(None, "user_version", 2).unwrap();
        db.execute("INSERT INTO seasons(year) VALUES (2024)", []).unwrap();
        db.execute("INSERT INTO f1_imports(id, season_year, imported_at) VALUES (7, 2024, '2024-01-01T00:00:00Z')", []).unwrap();
        db.execute("INSERT INTO f1_import_pages VALUES (7, 'races', 0, 'original')", []).unwrap();
        migrate(&mut db).unwrap();
        assert_eq!(db.query_row("SELECT payload FROM f1_import_pages WHERE import_id=7", [], |r| r.get::<_, String>(0)).unwrap(), "original");
        let repo = F1Repository { connection: db };
        assert_eq!(repo.list().unwrap()[0]["dataAt"], "2024-01-01T00:00:00Z");
    }

    #[test]
    fn version_three_to_four_keeps_original_snapshots() {
        let mut db = Connection::open_in_memory().unwrap();
        db.execute_batch(include_str!("migrations/001_initial.sql")).unwrap();
        db.execute_batch(include_str!("migrations/002_snapshots.sql")).unwrap();
        db.execute_batch(include_str!("migrations/003_restore_provenance.sql")).unwrap();
        db.pragma_update(None, "user_version", 3).unwrap();
        db.execute("INSERT INTO seasons(year) VALUES (2024)", []).unwrap();
        db.execute("INSERT INTO f1_imports(id, season_year, imported_at) VALUES (7, 2024, '2024-01-01T00:00:00Z')", []).unwrap();
        db.execute("INSERT INTO f1_import_pages VALUES (7, 'races', 0, 'original')", []).unwrap();
        migrate(&mut db).unwrap(); migrate(&mut db).unwrap();
        assert_eq!(db.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0)).unwrap(), 4);
        assert_eq!(db.query_row("SELECT payload FROM f1_import_pages WHERE import_id=7", [], |r| r.get::<_, String>(0)).unwrap(), "original");
        assert_eq!(db.query_row("SELECT count(*) FROM f1_saved_analyses", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
    }

    #[test]
    fn failed_save_rolls_back_and_preserves_previous_snapshot() {
        use super::super::jolpica::fixtures::season;
        let mut db = Connection::open_in_memory().unwrap();
        migrate(&mut db).unwrap();
        let mut repo = F1Repository { connection: db };
        let good = season(&[1, 2], &["a"]);
        repo.save(2024, &good).unwrap();
        repo.save(2024, &good).unwrap();
        repo.connection.execute_batch("CREATE TRIGGER fail_page BEFORE INSERT ON f1_import_pages BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;").unwrap();
        assert!(repo.save(2024, &season(&[1, 2, 3], &["a", "b"])).is_err());
        assert_eq!(repo.connection.query_row("SELECT count(*) FROM f1_imports", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
        assert_eq!(repo.connection.query_row("SELECT count(*) FROM f1_import_pages", [], |r| r.get::<_, i64>(0)).unwrap(), 3);
        assert_eq!(repo.connection.query_row("SELECT payload FROM f1_import_pages WHERE endpoint = 'races'", [], |r| r.get::<_, String>(0)).unwrap(), good[0].payload);
    }

    #[test]
    fn rejects_reduced_or_invalid_updates_but_preserves_and_appends_growth() {
        use super::super::jolpica::fixtures::season;
        let mut db = Connection::open_in_memory().unwrap();
        migrate(&mut db).unwrap();
        let mut repo = F1Repository { connection: db };
        repo.save(2024, &season(&[1, 2], &["a", "b"])).unwrap();
        assert!(repo.save(2024, &season(&[1], &["a", "b"])).is_err());
        assert!(repo.save(2024, &season(&[1, 2], &["a"])).is_err());
        assert!(repo.save(2024, &season(&[1, 2], &["a", "c"])).is_err()); // Same count, different driver.
        assert!(repo.save(2024, &season(&[1, 2], &[])).is_err());
        assert!(repo.save(2023, &season(&[1, 2], &["a", "b"])).is_err());
        assert!(repo.save(2024, &[]).is_err());
        repo.save(2024, &season(&[1, 2, 3], &["a", "b", "c"])).unwrap();
        assert_eq!(repo.connection.query_row("SELECT count(*) FROM f1_imports", [], |r| r.get::<_, i64>(0)).unwrap(), 2);
        assert_eq!(repo.connection.query_row("SELECT count(*) FROM f1_import_pages", [], |r| r.get::<_, i64>(0)).unwrap(), 6);
    }

    #[test]
    fn rejects_missing_sprint_and_driver_multiplicity() {
        use super::super::jolpica::fixtures::{page, result_race, season};
        let mut db = Connection::open_in_memory().unwrap();
        migrate(&mut db).unwrap();
        let mut repo = F1Repository { connection: db };
        let mut old = season(&[1], &["a", "a"]); // Two distinct source entries for the same driver.
        old[2] = page("sprint", 0, 1, vec![result_race(1, "sprint", &["b"])]);
        repo.save(2024, &old).unwrap();
        let mut no_sprint = season(&[1], &["a", "a"]);
        assert!(repo.save(2024, &no_sprint).is_err());
        no_sprint[2] = page("sprint", 0, 1, vec![result_race(1, "sprint", &["b"])]);
        no_sprint[1] = page("results", 0, 2, vec![result_race(1, "results", &["a", "c"])]);
        assert!(repo.save(2024, &no_sprint).is_err());
        assert_eq!(repo.connection.query_row("SELECT count(*) FROM f1_imports", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
    }

    #[test]
    fn cannot_advance_from_unreadable_previous_snapshot() {
        use super::super::jolpica::fixtures::season;
        let mut db = Connection::open_in_memory().unwrap();
        migrate(&mut db).unwrap();
        let mut repo = F1Repository { connection: db };
        repo.save(2024, &season(&[1], &["a"])).unwrap();
        repo.connection.execute("UPDATE f1_import_pages SET payload = 'corrupt' WHERE endpoint = 'results'", []).unwrap();
        let error = repo.save(2024, &season(&[1, 2], &["a"])).unwrap_err().to_string();
        assert!(error.contains("previous snapshot"));
        assert_eq!(repo.connection.query_row("SELECT count(*) FROM f1_imports", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
    }

    #[test]
    fn local_snapshot_can_be_queried_without_network() {
        use super::super::jolpica::fixtures::season;
        let mut db = Connection::open_in_memory().unwrap();
        migrate(&mut db).unwrap();
        let mut repo = F1Repository { connection: db };
        repo.save(2024, &season(&[1, 2], &["a", "b"])).unwrap();
        let local = repo.list().unwrap();
        assert_eq!(local[0]["year"], 2024);
        assert!(local[0]["importedAt"].is_string());
        let details = repo.details(2024).unwrap();
        assert_eq!(details["calendar"].as_array().unwrap().len(), 2);
        assert_eq!(details["results"].as_array().unwrap().len(), 2);
        assert_eq!(details["results"][0]["result"]["Driver"]["driverId"], "a");
        assert!(repo.details(2023).is_err());
    }

    #[test]
    fn analysis_reads_latest_valid_snapshot_without_modifying_database() {
        use super::super::jolpica::fixtures::season;
        let mut db = Connection::open_in_memory().unwrap(); migrate(&mut db).unwrap();
        let mut repo = F1Repository { connection: db };
        assert!(repo.analysis_snapshots().unwrap().is_empty());
        repo.save(2024, &season(&[1], &["a", "a"])).unwrap();
        let frozen = repo.analysis_snapshots().unwrap();
        assert_eq!(frozen[0]["results"].as_array().unwrap().len(), 2);
        repo.save(2024, &season(&[1, 2], &["a", "a", "b"])).unwrap();
        let current = repo.analysis_snapshots().unwrap();
        assert_ne!(frozen[0]["id"], current[0]["id"]);
        assert_eq!(frozen[0]["results"].as_array().unwrap().len(), 2);
        assert_eq!(repo.snapshots(2024).unwrap().len(), 2);
        repo.connection.execute("UPDATE f1_import_pages SET payload = 'corrupt' WHERE import_id = (SELECT MAX(id) FROM f1_imports) AND endpoint = 'results'", []).unwrap();
        assert!(repo.analysis_snapshots().is_err());
    }

    #[test]
    fn saved_analysis_is_transactional_and_reopens_original_snapshot() {
        use super::super::jolpica::fixtures::season;
        let mut db = Connection::open_in_memory().unwrap(); migrate(&mut db).unwrap();
        let mut repo = F1Repository { connection: db };
        repo.save(2024, &season(&[1], &["a", "a"])).unwrap();
        let frozen = repo.analysis_snapshots().unwrap();
        let reference = serde_json::json!({"partitionId":"2024", "revisionId":frozen[0]["id"], "sourceDataAt":frozen[0]["sourceDataAt"], "storedAt":frozen[0]["storedAt"]});
        let doc = serde_json::json!({"documentVersion":1,"id":"analysis-1","revision":null,"title":"Synthetic", "datasetId":"f1.session_results","datasetSchemaVersion":"1","datasetSemanticVersion":"1", "selection":{"protocolVersion":1,"datasetId":"f1.session_results","token":"opaque","transformationVersion":"f1-results-1","revisions":[reference]},"visualization":{"kind":"table","x":"season","metric":{"metricId":"points","aggregation":"sum"},"series":null,"comparison":null,"runningSum":false},"filters":[],"createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z"});
        let saved = repo.saved_save(doc.clone(), None).unwrap();
        let revision = saved["revision"].as_str().unwrap().to_string();
        assert_eq!(repo.saved_save(doc.clone(), None).unwrap_err(), "CONFLICT");
        assert_eq!(repo.saved_list().unwrap().len(), 1);
        let mut malformed = saved.clone(); malformed["unknown"] = serde_json::json!(true);
        assert_eq!(repo.saved_save(malformed, Some(revision.clone())).unwrap_err(), "INVALID_CONTRACT");
        let mut wrong = saved.clone(); wrong["selection"]["revisions"][0]["revisionId"] = serde_json::json!("999999");
        assert_eq!(repo.saved_save(wrong, Some(revision.clone())).unwrap_err(), "REVISION_MISSING");
        let mut future = saved.clone(); future["documentVersion"] = serde_json::json!(2);
        assert_eq!(repo.saved_save(future, Some(revision.clone())).unwrap_err(), "INVALID_CONTRACT");
        let mut reversed = saved.clone(); reversed["filters"] = serde_json::json!([{"fieldId":"points_raw","op":"range","min":"2.1","max":"2.09"}]);
        assert_eq!(repo.saved_save(reversed, Some(revision.clone())).unwrap_err(), "INVALID_CONTRACT");
        let mut updated = saved.clone(); updated["title"] = serde_json::json!("Updated");
        let next = repo.saved_save(updated, Some(revision.clone())).unwrap();
        assert_ne!(next["revision"], saved["revision"]);
        assert_eq!(repo.saved_save(saved, Some(revision)).unwrap_err(), "CONFLICT");
        repo.save(2024, &season(&[1, 2], &["a", "a", "b"])).unwrap();
        let reopened = repo.saved_load("analysis-1").unwrap();
        let refs: Vec<super::super::saved_analysis::Revision> = serde_json::from_value(reopened["selection"]["revisions"].clone()).unwrap();
        assert_eq!(repo.analysis_snapshots_for(Some(refs)).unwrap(), frozen);
        assert_eq!(repo.snapshots(2024).unwrap().len(), 2);
        repo.connection.execute("DELETE FROM f1_import_pages WHERE import_id = ?1", [frozen[0]["id"].as_str().unwrap().parse::<i64>().unwrap()]).unwrap();
        let refs = serde_json::from_value(reopened["selection"]["revisions"].clone()).unwrap();
        assert!(repo.analysis_snapshots_for(Some(refs)).is_err());
    }

    #[test]
    fn saved_analysis_survives_reopen_and_conflicts_across_connections() {
        use super::super::jolpica::fixtures::season;
        let base = if std::path::Path::new("/tmp/opencode").is_dir() { std::path::PathBuf::from("/tmp/opencode") } else { std::env::temp_dir() };
        let path = base.join(format!("rds-analysis-test-{}-{}.sqlite", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let mut db = Connection::open(&path).unwrap(); migrate(&mut db).unwrap();
        let mut first = F1Repository { connection: db };
        first.save(2024, &season(&[1], &["a"])).unwrap();
        let snap = first.analysis_snapshots().unwrap();
        let doc = serde_json::json!({"documentVersion":1,"id":"saved","revision":null,"title":"Synthetic", "datasetId":"f1.session_results","datasetSchemaVersion":"1","datasetSemanticVersion":"1", "selection":{"protocolVersion":1,"datasetId":"f1.session_results","token":"token","transformationVersion":"f1-results-1","revisions":[{"partitionId":"2024","revisionId":snap[0]["id"],"sourceDataAt":snap[0]["sourceDataAt"],"storedAt":snap[0]["storedAt"]}]},"visualization":{"kind":"table","x":"season","metric":{"metricId":"points","aggregation":"sum"},"series":null,"comparison":null,"runningSum":false},"filters":[],"createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z"});
        let saved = first.saved_save(doc, None).unwrap();
        drop(first);
        let mut db = Connection::open(&path).unwrap(); migrate(&mut db).unwrap();
        let mut first = F1Repository { connection: db };
        let mut db2 = Connection::open(&path).unwrap(); migrate(&mut db2).unwrap();
        let mut second = F1Repository { connection: db2 };
        let a = first.saved_load("saved").unwrap(); let b = second.saved_load("saved").unwrap();
        assert_eq!(a, saved); let revision = a["revision"].as_str().unwrap().to_owned();
        first.saved_save(a, Some(revision.clone())).unwrap();
        assert_eq!(second.saved_save(b, Some(revision)).unwrap_err(), "CONFLICT");
        drop(first); drop(second);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn event_projections_preserve_fragments_and_do_not_change_sqlite() {
        use super::super::jolpica::fixtures::{page, race, result_race};
        let mut db = Connection::open_in_memory().unwrap(); migrate(&mut db).unwrap();
        let mut repo = F1Repository { connection: db };
        let pages = vec![page("races", 0, 2, vec![race(1), race(2)]), page("results", 0, 2, vec![result_race(1, "results", &["a"])]), page("results", 1, 2, vec![result_race(1, "results", &["b"])]), page("sprint", 0, 0, vec![])];
        repo.save(2024, &pages).unwrap();
        let id = repo.snapshots(2024).unwrap()[0]["id"].as_i64().unwrap();
        let events = repo.event_archives(2024, id).unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].payload["race_fragments"].as_array().unwrap().len(), 2);
        assert!(events[1].payload["race_fragments"].as_array().unwrap().is_empty());
        assert!(repo.event_archives(2023, id).is_err());
        assert_eq!(repo.snapshots(2024).unwrap().len(), 1);
        assert_eq!(repo.connection.query_row("SELECT count(*) FROM f1_import_pages", [], |r| r.get::<_, i64>(0)).unwrap(), 4);
    }

    #[test]
    fn restore_is_transactional_and_keeps_all_snapshots() {
        use super::super::jolpica::fixtures::season;
        let mut db = Connection::open_in_memory().unwrap(); migrate(&mut db).unwrap();
        let mut repo = F1Repository { connection: db };
        repo.save(2024, &season(&[1], &["a"])).unwrap();
        let old = repo.snapshots(2024).unwrap()[0]["id"].as_i64().unwrap();
        repo.connection.execute("UPDATE f1_imports SET imported_at = '2020-01-01T00:00:00Z' WHERE id = ?1", [old]).unwrap();
        repo.save(2024, &season(&[1, 2], &["a", "b"])).unwrap();
        assert!(repo.restore(2023, old).is_err());
        repo.connection.execute_batch("CREATE TRIGGER fail_restore BEFORE INSERT ON f1_import_pages BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;").unwrap();
        assert!(repo.restore(2024, old).is_err());
        assert_eq!(repo.snapshots(2024).unwrap().len(), 2);
        assert_eq!(repo.details(2024).unwrap()["calendar"].as_array().unwrap().len(), 2);
        repo.connection.execute_batch("DROP TRIGGER fail_restore;").unwrap();
        repo.restore(2024, old).unwrap();
        assert_eq!(repo.snapshots(2024).unwrap().len(), 3);
        assert_eq!(repo.list().unwrap()[0]["dataAt"], "2020-01-01T00:00:00Z");
        assert_eq!(repo.details(2024).unwrap()["calendar"].as_array().unwrap().len(), 1);
        assert_eq!(repo.connection.query_row("SELECT count(*) FROM f1_import_pages WHERE import_id = ?1", [old], |r| r.get::<_, i64>(0)).unwrap(), 3);
    }

    #[test]
    fn corrupt_snapshot_cannot_be_restored() {
        use super::super::jolpica::fixtures::season;
        let mut db = Connection::open_in_memory().unwrap(); migrate(&mut db).unwrap();
        let mut repo = F1Repository { connection: db };
        repo.save(2024, &season(&[1], &["a"])).unwrap();
        let old = repo.snapshots(2024).unwrap()[0]["id"].as_i64().unwrap();
        repo.save(2024, &season(&[1, 2], &["a", "b"])).unwrap();
        repo.connection.execute("UPDATE f1_import_pages SET payload = 'invalid' WHERE import_id = ?1 AND endpoint = 'races'", [old]).unwrap();
        assert!(repo.restore(2024, old).is_err());
        assert_eq!(repo.snapshots(2024).unwrap().len(), 2);
        assert_eq!(repo.details(2024).unwrap()["calendar"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn opens_only_f1_database_below_app_data() {
        let dir = std::env::temp_dir().join(format!("rds-f1-test-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let repo = F1Repository::open(&dir).unwrap();
        assert!(dir.join("categories/f1.sqlite").is_file());
        assert_eq!(fs::read_dir(dir.join("categories")).unwrap().count(), 1);
        drop(repo);
        fs::remove_dir_all(dir).unwrap();
    }
}
