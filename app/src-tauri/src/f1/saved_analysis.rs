//! Strict, version-specific validation at the native persistence boundary.
use rusqlite::{Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Revision {
    pub partition_id: String,
    pub revision_id: String,
    pub source_data_at: Option<String>,
    pub stored_at: String,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Selection { protocol_version: u8, dataset_id: String, token: String, transformation_version: String, revisions: Vec<Revision> }
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Metric { metric_id: String, aggregation: String }
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Visualization { kind: String, x: String, metric: Metric, series: Option<String>, comparison: Option<String>, running_sum: bool }
#[derive(Deserialize, Serialize)]
#[serde(tag = "op", deny_unknown_fields)]
enum Filter {
    #[serde(rename = "in")] In { #[serde(rename = "fieldId")] field_id: String, values: Vec<Value> },
    #[serde(rename = "range")] Range { #[serde(rename = "fieldId")] field_id: String, #[serde(skip_serializing_if = "Option::is_none")] min: Option<Value>, #[serde(skip_serializing_if = "Option::is_none")] max: Option<Value> },
    #[serde(rename = "contains")] Contains { #[serde(rename = "fieldId")] field_id: String, value: String },
    #[serde(rename = "isNull")] IsNull { #[serde(rename = "fieldId")] field_id: String },
    #[serde(rename = "isNotNull")] IsNotNull { #[serde(rename = "fieldId")] field_id: String },
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Document {
    document_version: u8, id: String, revision: Option<String>, title: String,
    dataset_id: String, dataset_schema_version: String, dataset_semantic_version: String,
    selection: Selection, visualization: Visualization, filters: Vec<Filter>, created_at: String, updated_at: String,
}
type Result<T> = std::result::Result<T, String>;
fn invalid() -> String { "INVALID_CONTRACT".into() }
fn id(s: &str) -> bool { !s.is_empty() && s.len() <= 128 && !["__proto__", "constructor", "prototype"].contains(&s) && s.bytes().enumerate().all(|(i, c)| c.is_ascii_alphanumeric() || (i > 0 && b"_.:-".contains(&c))) }
fn timestamp(s: &str) -> bool {
    // UTC timestamps are emitted by this application; offsets remain supported by the UI contract,
    // but are intentionally rejected by this native v1 store until explicitly implemented.
    let b = s.as_bytes();
    if !(20..=24).contains(&b.len()) || b[4] != b'-' || b[7] != b'-' || b[10] != b'T' || b[13] != b':' || b[16] != b':' || b[b.len()-1] != b'Z' || !b.iter().enumerate().all(|(i, c)| [4,7,10,13,16,b.len()-1].contains(&i) || (i == 19 && *c == b'.') || c.is_ascii_digit()) { return false; }
    if b.len() != 20 && !(22..=24).contains(&b.len()) { return false; }
    let number = |a, z| s.get(a..z).and_then(|x| x.parse::<u32>().ok()).unwrap_or(9999);
    let (y, m, d) = (number(0,4), number(5,7), number(8,10));
    let days = match m { 1|3|5|7|8|10|12 => 31, 4|6|9|11 => 30, 2 if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) => 29, 2 => 28, _ => 0 };
    d >= 1 && d <= days && number(11,13) < 24 && number(14,16) < 60 && number(17,19) < 60
}
fn decimal(s: &str) -> bool {
    if s.len() > 100 || s.is_empty() { return false; }
    let s = s.strip_prefix('-').unwrap_or(s); let mut parts = s.split('.');
    let whole = parts.next().unwrap_or("");
    !whole.is_empty() && whole.bytes().all(|c| c.is_ascii_digit()) && (whole == "0" || !whole.starts_with('0')) && parts.next().map_or(true, |x| !x.is_empty() && x.bytes().all(|c| c.is_ascii_digit())) && parts.next().is_none()
}
fn scalar(field: &str, v: &Value) -> bool {
    match field {
        "round" => v.as_i64().map_or(false, |n| n.abs_diff(0) <= 9_007_199_254_740_991),
        "points_raw" => v.as_str().map_or(false, decimal),
        "season"|"session"|"driver"|"team" => v.as_str().map_or(false, |s| s.encode_utf16().count() <= 4000),
        _ => false,
    }
}
fn decimal_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    fn parts(s: &str) -> (bool, &str, &str) {
        let neg = s.starts_with('-'); let s = s.strip_prefix('-').unwrap_or(s);
        let (whole, fraction) = s.split_once('.').unwrap_or((s, ""));
        let fraction = fraction.trim_end_matches('0');
        (neg && (whole != "0" || !fraction.is_empty()), whole, fraction)
    }
    let (an, aw, af) = parts(a); let (bn, bw, bf) = parts(b);
    if an != bn { return if an { std::cmp::Ordering::Less } else { std::cmp::Ordering::Greater }; }
    let order = aw.len().cmp(&bw.len()).then_with(|| aw.cmp(bw)).then_with(|| {
        let n = af.len().max(bf.len());
        af.bytes().chain(std::iter::repeat(b'0')).take(n).cmp(bf.bytes().chain(std::iter::repeat(b'0')).take(n))
    });
    if an { order.reverse() } else { order }
}
fn validate(doc: &Document) -> Result<()> {
    if doc.document_version != 1 || doc.dataset_id != "f1.session_results" || doc.dataset_schema_version != "1" || doc.dataset_semantic_version != "1" || !id(&doc.id) || doc.title.trim().is_empty() || doc.title.encode_utf16().count() > 200 || !timestamp(&doc.created_at) || !timestamp(&doc.updated_at) { return Err(invalid()); }
    let s = &doc.selection;
    if s.protocol_version != 1 || s.dataset_id != doc.dataset_id || s.transformation_version != "f1-results-1" || s.token.is_empty() || s.token.len() > 2000 || s.revisions.is_empty() || s.revisions.len() > 151 { return Err(invalid()); }
    let mut seasons = HashSet::new();
    for r in &s.revisions {
        let year = r.partition_id.parse::<u16>().map_err(|_| invalid())?;
        let snapshot = r.revision_id.parse::<i64>().map_err(|_| invalid())?;
        if !(1950..=2100).contains(&year) || year.to_string() != r.partition_id || snapshot <= 0 || snapshot.to_string() != r.revision_id || !seasons.insert(year) || !timestamp(&r.stored_at) || !r.source_data_at.as_deref().map_or(true, timestamp) { return Err(invalid()); }
    }
    let v = &doc.visualization;
    let fields = ["season", "round", "session", "driver", "team"];
    let mut dims = HashSet::new();
    for x in std::iter::once(&v.x).chain(v.series.iter()).chain(v.comparison.iter()) { if !fields.contains(&x.as_str()) || !dims.insert(x.as_str()) { return Err(invalid()); } }
    if !dims.contains("season") || !["table", "line", "bar"].contains(&v.kind.as_str()) || (v.kind == "line" && !["season", "round"].contains(&v.x.as_str())) || v.comparison.as_deref().map_or(false, |x| x != "season") || v.running_sum || !matches!((v.metric.metric_id.as_str(), v.metric.aggregation.as_str()), ("points", "sum") | ("observations", "count")) { return Err(invalid()); }
    if doc.filters.len() > 30 { return Err(invalid()); }
    let mut filtered = HashSet::new();
    for f in &doc.filters {
        let field = match f {
            Filter::In { field_id, values } => { if !fields.contains(&field_id.as_str()) || values.is_empty() || values.len() > 200 || !values.iter().all(|v| scalar(field_id, v)) { return Err(invalid()); } field_id },
            Filter::Contains { field_id, value } => { if !["season", "session", "driver", "team"].contains(&field_id.as_str()) || value.is_empty() || value.encode_utf16().count() > 300 { return Err(invalid()); } field_id },
            Filter::Range { field_id, min, max } => {
                if !["round", "points_raw"].contains(&field_id.as_str()) || (min.is_none() && max.is_none()) || !min.iter().chain(max.iter()).all(|v| scalar(field_id, v)) { return Err(invalid()); }
                if let (Some(a), Some(b)) = (min, max) {
                    let reversed = if field_id == "round" { a.as_i64() > b.as_i64() } else { decimal_cmp(a.as_str().ok_or_else(invalid)?, b.as_str().ok_or_else(invalid)?) == std::cmp::Ordering::Greater };
                    if reversed { return Err(invalid()); }
                }
                field_id
            },
            Filter::IsNull { field_id } | Filter::IsNotNull { field_id } => { if !["driver", "team", "points_raw"].contains(&field_id.as_str()) { return Err(invalid()); } field_id },
        };
        if !filtered.insert(field) { return Err(invalid()); }
    }
    Ok(())
}
pub fn check_revisions(connection: &Connection, refs: &[Revision]) -> Result<()> {
    let mut bytes = 0usize;
    for r in refs {
        let year = r.partition_id.parse::<u16>().map_err(|_| invalid())?;
        let id = r.revision_id.parse::<i64>().map_err(|_| invalid())?;
        let actual: Option<(String, String)> = connection.query_row("SELECT imported_at, COALESCE(source_imported_at, imported_at) FROM f1_imports WHERE id = ?1 AND season_year = ?2", rusqlite::params![id, year], |row| Ok((row.get(0)?, row.get(1)?))).optional().map_err(|e| e.to_string())?;
        if actual.is_none() || actual != r.source_data_at.as_ref().map(|source| (r.stored_at.clone(), source.clone())) { return Err("REVISION_MISSING".into()); }
        let mut pages = Vec::new();
        let mut stmt = connection.prepare("SELECT endpoint, page_offset, payload FROM f1_import_pages WHERE import_id = ?1 ORDER BY endpoint, page_offset").map_err(|e| e.to_string())?;
        let mut rows = stmt.query([id]).map_err(|e| e.to_string())?;
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let name: String = row.get(0).map_err(|e| e.to_string())?;
            let endpoint = match name.as_str() { "races" => "races", "results" => "results", "sprint" => "sprint", _ => return Err("REVISION_MISSING".into()) };
            let payload: String = row.get(2).map_err(|e| e.to_string())?;
            bytes = bytes.checked_add(payload.len()).ok_or("LIMIT_EXCEEDED")?;
            if bytes > 64 * 1024 * 1024 { return Err("LIMIT_EXCEEDED".into()); }
            pages.push(super::jolpica::Page { endpoint, offset: usize::try_from(row.get::<_, i64>(1).map_err(|e| e.to_string())?).map_err(|_| "REVISION_MISSING")?, payload });
        }
        super::jolpica::validate_pages(year, &pages).map_err(|_| "REVISION_MISSING")?;
    }
    Ok(())
}
fn parse(value: Value) -> Result<Document> {
    let serialized = serde_json::to_string(&value).map_err(|_| invalid())?;
    if serialized.len() > 512_000 || serialized.encode_utf16().count() > 256_000 { return Err(invalid()); }
    if value.get("revision").is_none() || value.pointer("/visualization/series").is_none() || value.pointer("/visualization/comparison").is_none() || value.pointer("/selection/revisions").and_then(Value::as_array).map_or(true, |refs| refs.iter().any(|r| r.get("sourceDataAt").is_none())) { return Err(invalid()); }
    if value.get("filters").and_then(Value::as_array).map_or(true, |filters| filters.iter().any(|f| f.get("op").and_then(Value::as_str) == Some("range") && ["min", "max"].iter().any(|key| f.get(*key).map_or(false, Value::is_null)))) { return Err(invalid()); }
    let doc: Document = serde_json::from_value(value).map_err(|_| invalid())?; validate(&doc)?; Ok(doc)
}
pub fn save(connection: &mut Connection, value: Value, expected: Option<String>) -> Result<Value> {
    let mut doc = parse(value)?;
    if doc.revision != expected || expected.as_ref().map_or(false, |s| s.len() != 32 || !s.bytes().all(|c| c.is_ascii_hexdigit())) { return Err("CONFLICT".into()); }
    let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
    check_revisions(&tx, &doc.selection.revisions)?;
    let previous: Option<String> = tx.query_row("SELECT revision FROM f1_saved_analyses WHERE id = ?1", [&doc.id], |r| r.get(0)).optional().map_err(|e| e.to_string())?;
    if previous != expected { return Err("CONFLICT".into()); }
    if previous.is_none() && tx.query_row("SELECT count(*) FROM f1_saved_analyses", [], |r| r.get::<_, i64>(0)).map_err(|e| e.to_string())? >= 1000 { return Err("LIMIT_EXCEEDED".into()); }
    let revision: String = tx.query_row("SELECT lower(hex(randomblob(16)))", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    doc.revision = Some(revision.clone());
    let value = serde_json::to_value(&doc).map_err(|_| invalid())?;
    let serialized = serde_json::to_string(&value).map_err(|_| invalid())?;
    tx.execute("INSERT INTO f1_saved_analyses(id, revision, document) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, document = excluded.document", rusqlite::params![doc.id, revision, serialized]).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?; Ok(value)
}
pub fn load(connection: &Connection, id_value: &str) -> Result<Value> {
    if !id(id_value) { return Err(invalid()); }
    let tx = connection.unchecked_transaction().map_err(|e| e.to_string())?;
    let raw: Option<(String, String)> = tx.query_row("SELECT document, revision FROM f1_saved_analyses WHERE id = ?1", [id_value], |r| Ok((r.get(0)?, r.get(1)?))).optional().map_err(|e| e.to_string())?;
    let (raw, revision) = raw.ok_or("REVISION_MISSING")?;
    let value: Value = serde_json::from_str(&raw).map_err(|_| invalid())?;
    let doc = parse(value)?;
    if doc.id != id_value || doc.revision.as_deref() != Some(&revision) { return Err(invalid()); }
    check_revisions(&tx, &doc.selection.revisions)?;
    let value = serde_json::to_value(doc).map_err(|_| invalid())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(value)
}
pub fn list(connection: &Connection) -> Result<Vec<Value>> {
    let mut stmt = connection.prepare("SELECT id, revision, document FROM f1_saved_analyses ORDER BY id LIMIT 1001").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))).map_err(|e| e.to_string())?.collect::<std::result::Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    if rows.len() > 1000 { return Err("LIMIT_EXCEEDED".into()); }
    let mut list = Vec::new();
    for (id, revision, raw) in rows {
        let value: Value = serde_json::from_str(&raw).map_err(|_| invalid())?;
        let doc = parse(value)?;
        if doc.id != id || doc.revision.as_deref() != Some(&revision) { return Err(invalid()); }
        list.push(json!({"id":id,"revision":revision,"title":doc.title,"updatedAt":doc.updated_at}));
    }
    Ok(list)
}
