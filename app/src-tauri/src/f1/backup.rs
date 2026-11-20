use rusqlite::{
    backup::{Backup, StepResult},
    Connection, OpenFlags,
};
use std::{
    error::Error,
    fs,
    io::{self, Read, Seek},
    path::{Component, Path},
};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

const APPLICATION_ID: i32 = 0x52445346; // RDSF
const DATABASE_NAME: &str = "f1.sqlite";
type Result<T> = std::result::Result<T, Box<dyn Error>>;

pub(super) fn file_name(timestamp: chrono::NaiveDateTime) -> String {
    format!("rds-F1_{}.zip", timestamp.format("%Y%m%d%H%M"))
}

fn has_extension(path: &Path, expected: &str) -> bool {
    path.extension().and_then(|ext| ext.to_str()).is_some_and(|ext| ext.eq_ignore_ascii_case(expected))
}

pub(super) fn validate_path(data_dir: &Path, path: &Path, restore: bool) -> Result<()> {
    if !path.is_absolute() || path.components().any(|component| component == Component::ParentDir)
        || !(has_extension(path, "zip") || (restore && has_extension(path, "sqlite")))
    {
        return Err("BACKUP_INVALID_PATH".into());
    }
    let parent = path.parent().ok_or("BACKUP_INVALID_PATH")?.canonicalize()?;
    if fs::canonicalize(data_dir).is_ok_and(|data| parent.starts_with(data)) {
        return Err("BACKUP_INVALID_PATH".into());
    }
    Ok(())
}

fn copy(source: &Connection, destination: &mut Connection) -> Result<()> {
    let backup = Backup::new(source, destination)?;
    loop {
        match backup.step(256)? {
            StepResult::More => continue,
            StepResult::Done => return Ok(()),
            _ => return Err("BACKUP_DATABASE_BUSY".into()),
        }
    }
}

fn schema(connection: &Connection) -> Result<Vec<(String, String, String)>> {
    let mut stmt = connection.prepare("SELECT type, name, sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY name")?;
    let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

fn validate(backup: &Connection, reference: &Connection) -> Result<()> {
    let application_id: i32 = backup.pragma_query_value(None, "application_id", |row| row.get(0))?;
    let version: u32 = backup.pragma_query_value(None, "user_version", |row| row.get(0))?;
    let expected_version: u32 = reference.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if application_id != APPLICATION_ID || version != expected_version || schema(backup)? != schema(reference)? {
        return Err("BACKUP_INCOMPATIBLE".into());
    }
    let check: String = backup.pragma_query_value(None, "quick_check", |row| row.get(0))?;
    if check != "ok" || backup.prepare("PRAGMA foreign_key_check")?.exists([])? {
        return Err("BACKUP_CORRUPT".into());
    }
    Ok(())
}

pub(super) fn export(source: &Connection, path: &Path) -> Result<()> {
    let parent = path.parent().ok_or("BACKUP_INVALID_PATH")?;
    let database = tempfile::NamedTempFile::new_in(parent)?;
    let mut destination = Connection::open(database.path())?;
    copy(source, &mut destination)?;
    destination.pragma_update(None, "application_id", APPLICATION_ID)?;
    validate(&destination, source)?;
    drop(destination);
    let mut database_file = database.reopen()?;
    let mut output = tempfile::NamedTempFile::new_in(parent)?;
    let mut archive = ZipWriter::new(output.as_file_mut());
    // Leave room for compression overhead near the classic ZIP size limit.
    let large_file = database_file.metadata()?.len() >= u64::from(u32::MAX) - 16 * 1024 * 1024;
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .large_file(large_file);
    archive.start_file(DATABASE_NAME, options)?;
    io::copy(&mut database_file, &mut archive)?;
    archive.finish()?.sync_all()?;
    output.persist_noclobber(path)?;
    Ok(())
}

pub(super) fn restore(destination: &mut Connection, path: &Path) -> Result<()> {
    if has_extension(path, "sqlite") {
        return restore_sqlite(destination, path);
    }
    if !has_extension(path, "zip") || !fs::symlink_metadata(path)?.is_file() {
        return Err("BACKUP_INVALID_PATH".into());
    }
    let database = unpack(fs::File::open(path)?)?;
    restore_sqlite(destination, database.path())
}

fn unpack(input: impl Read + Seek) -> Result<tempfile::NamedTempFile> {
    let mut archive = ZipArchive::new(input)?;
    if archive.len() != 1 {
        return Err("BACKUP_INVALID_ARCHIVE".into());
    }
    let entry = archive.by_index(0)?;
    if !entry.is_file() || entry.name()?.as_ref() != DATABASE_NAME {
        return Err("BACKUP_INVALID_ARCHIVE".into());
    }
    // Extract only the database into a file we own, keeping the live database intact.
    let expected = entry.size();
    let mut database = tempfile::NamedTempFile::new()?;
    let written = io::copy(
        &mut entry.take(expected.saturating_add(1)),
        database.as_file_mut(),
    )?;
    if written != expected {
        return Err("BACKUP_CORRUPT".into());
    }
    Ok(database)
}

fn restore_sqlite(destination: &mut Connection, path: &Path) -> Result<()> {
    let mut source = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NOFOLLOW)?;
    source.pragma_update(None, "trusted_schema", false)?;
    let transaction = source.transaction()?;
    validate(&transaction, destination)?;
    copy(&transaction, destination)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_name_has_category_date_and_time_to_the_minute() {
        let timestamp = chrono::NaiveDate::from_ymd_opt(2026, 11, 8).unwrap()
            .and_hms_opt(9, 3, 59).unwrap();
        assert_eq!(file_name(timestamp), "rds-F1_202611080903.zip");
    }

    #[test]
    fn unpack_accepts_only_the_single_expected_database_entry() {
        let mut input = io::Cursor::new(Vec::new());
        let mut archive = ZipWriter::new(&mut input);
        archive.start_file("../f1.sqlite", SimpleFileOptions::default()).unwrap();
        archive.finish().unwrap();
        input.rewind().unwrap();
        assert!(unpack(input).is_err());

        let mut input = io::Cursor::new(Vec::new());
        let mut archive = ZipWriter::new(&mut input);
        archive.start_file(DATABASE_NAME, SimpleFileOptions::default()).unwrap();
        archive.start_file("other.sqlite", SimpleFileOptions::default()).unwrap();
        archive.finish().unwrap();
        input.rewind().unwrap();
        assert!(unpack(input).is_err());
    }
}
