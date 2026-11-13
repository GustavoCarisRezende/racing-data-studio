//! Versioned model storage. No snapshot references or executable configuration.
use rusqlite::{Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;

type Result<T> = std::result::Result<T, String>;
fn invalid() -> String { "INVALID_CONTRACT".into() }
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Binding { policy: String, partition_ids: Vec<String> }
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Metric { metric_id: String, aggregation: String }
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Sort { column_id: String, direction: String }
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Table { version: u8, columns: Vec<String>, #[serde(skip_serializing_if = "Option::is_none")] sort: Option<Sort> }
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Calculation { version: u8, profile_id: String }
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Visualization {
    kind: String, x: String, metric: Metric, series: Option<String>, comparison: Option<String>, running_sum: bool,
    #[serde(skip_serializing_if = "Option::is_none")] secondary_metric: Option<Metric>,
    #[serde(skip_serializing_if = "Option::is_none")] cumulative_scope: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] table: Option<Table>,
    #[serde(skip_serializing_if = "Option::is_none")] extra_dimensions: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")] calculation: Option<Calculation>,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Model {
    document_version: u8, kind: String, id: String, revision: Option<String>, title: String,
    dataset_id: String, dataset_schema_version: String, dataset_semantic_version: String,
    binding: Binding, visualization: Visualization, filters: Vec<Value>, created_at: String, updated_at: String,
}
fn metric(m: &Metric) -> bool { matches!((m.metric_id.as_str(), m.aggregation.as_str()), ("points", "sum") | ("observations", "count")) }
fn parse(raw: Value) -> Result<Model> {
    let serialized = serde_json::to_string(&raw).map_err(|_| invalid())?;
    if serialized.len() > 512_000 || serialized.encode_utf16().count() > 256_000 || raw.get("revision").is_none() || raw.pointer("/visualization/series").is_none() || raw.pointer("/visualization/comparison").is_none() { return Err(invalid()); }
    for key in ["secondaryMetric", "cumulativeScope", "table", "extraDimensions", "calculation"] { if raw.pointer(&format!("/visualization/{key}")).map_or(false, Value::is_null) { return Err(invalid()); } }
    let doc: Model = serde_json::from_value(raw).map_err(|_| invalid())?;
    if ![2, 3].contains(&doc.document_version) { return Err("UNSUPPORTED_VERSION".into()); }
    if doc.kind != "model" || doc.binding.policy != "latest" || doc.binding.partition_ids.len() > 151 { return Err(invalid()); }
    let mut partitions = HashSet::new();
    for s in &doc.binding.partition_ids { let year = s.parse::<u16>().map_err(|_| invalid())?; if !(1950..=2100).contains(&year) || year.to_string() != *s || !partitions.insert(s) { return Err(invalid()); } }
    // Reuse the v1 native validation for shared IDs, timestamps, version and filters.
    super::saved_analysis::validate_model_common(json!({"documentVersion":1,"id":doc.id,"revision":doc.revision,"title":doc.title,"datasetId":doc.dataset_id,"datasetSchemaVersion":doc.dataset_schema_version,"datasetSemanticVersion":doc.dataset_semantic_version,"selection":{"protocolVersion":1,"datasetId":"f1.session_results","token":"model-validation","transformationVersion":"f1-results-1","revisions":[{"partitionId":"2024","revisionId":"1","sourceDataAt":"2024-01-01T00:00:00Z","storedAt":"2024-01-01T00:00:00Z"}]},"visualization":{"kind":"table","x":"season","metric":{"metricId":"points","aggregation":"sum"},"series":null,"comparison":null,"runningSum":false},"filters":doc.filters,"createdAt":doc.created_at,"updatedAt":doc.updated_at}))?;
    let v = &doc.visualization;
    let mut dims = HashSet::new();
    if doc.document_version == 2 && (v.extra_dimensions.is_some() || v.calculation.is_some()) { return Err(invalid()); }
    for d in std::iter::once(&v.x).chain(v.series.iter()).chain(v.comparison.iter()).chain(v.extra_dimensions.iter().flatten()) {
        if !["season", "round", "driver", "team", "session"].contains(&d.as_str()) || !dims.insert(d.as_str()) { return Err(invalid()); }
    }
    if dims.len() > 4 || !dims.contains("season") || !["table", "line", "bar", "pie", "scatter"].contains(&v.kind.as_str()) || (v.kind == "line" && !["season", "round"].contains(&v.x.as_str())) || v.comparison.as_deref().map_or(false, |s| s != "season") || !metric(&v.metric) || v.cumulative_scope.as_deref().map_or(false, |s| s != "filteredSelection") { return Err(invalid()); }
    match &v.calculation {
        Some(c) => if doc.document_version != 3 || c.version != 3 || c.profile_id != "driver-all-sessions-v1" || !v.running_sum || v.x != "round" || v.metric.metric_id != "points" || v.metric.aggregation != "sum" || dims != HashSet::from(["round", "driver", "season", "session"]) || !["table", "line", "bar"].contains(&v.kind.as_str()) || v.cumulative_scope.is_some() { return Err(invalid()); },
        None => if v.running_sum && (v.x != "round" && v.x != "season" || v.metric.metric_id != "points" || v.metric.aggregation != "sum" || !["table", "line", "bar"].contains(&v.kind.as_str()) || v.extra_dimensions.is_some()) { return Err(invalid()); },
    }
    match (&v.secondary_metric, v.kind.as_str()) {
        (Some(m), "scatter") if metric(m) && m.metric_id != v.metric.metric_id => (),
        (None, kind) if kind != "scatter" => (),
        _ => return Err(invalid()),
    }
    if let Some(table) = &v.table {
        let mut allowed = dims; allowed.insert(&v.metric.metric_id); if let Some(m) = &v.secondary_metric { allowed.insert(&m.metric_id); }
        let mut unique = HashSet::new();
        if table.version != 1 || table.columns.is_empty() || table.columns.len() > 210 || table.columns.iter().any(|c| !allowed.contains(c.as_str()) || !unique.insert(c)) || table.sort.as_ref().map_or(false, |s| !allowed.contains(s.column_id.as_str()) || !["asc", "desc"].contains(&s.direction.as_str())) { return Err(invalid()); }
    }
    Ok(doc)
}
fn stored(connection: &Connection, id: &str) -> Result<(String, Model)> {
    if id.len() > 128 { return Err(invalid()); }
    let row: Option<(String, String)> = connection.query_row("SELECT revision, document FROM f1_saved_models WHERE id=?1", [id], |r| Ok((r.get(0)?, r.get(1)?))).optional().map_err(|e| e.to_string())?;
    let (revision, raw) = row.ok_or("REVISION_MISSING")?;
    let doc = parse(serde_json::from_str(&raw).map_err(|_| invalid())?)?;
    if doc.id != id || doc.revision.as_deref() != Some(&revision) { return Err(invalid()); }
    Ok((revision, doc))
}
pub fn list(connection: &Connection, allow_v3: bool) -> Result<Vec<Value>> {
    let mut stmt = connection.prepare("SELECT id FROM f1_saved_models ORDER BY id LIMIT 1001").map_err(|e| e.to_string())?;
    let ids = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?.collect::<std::result::Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    if ids.len() > 1000 { return Err("LIMIT_EXCEEDED".into()); }
    let mut result = Vec::new();
    for id in ids { let (revision, doc) = stored(connection, &id)?; if allow_v3 || doc.document_version == 2 { result.push(json!({"id":id,"revision":revision,"title":doc.title,"updatedAt":doc.updated_at})); } }
    Ok(result)
}
pub fn load(connection: &Connection, id: &str, allow_v3: bool) -> Result<Value> { let doc = stored(connection, id)?.1; if !allow_v3 && doc.document_version != 2 { return Err("UNSUPPORTED_VERSION".into()); } serde_json::to_value(doc).map_err(|_| invalid()) }
pub fn save(connection: &mut Connection, raw: Value, expected: Option<String>, allow_v3: bool) -> Result<Value> {
    let mut doc = parse(raw)?;
    if !allow_v3 && doc.document_version != 2 { return Err("UNSUPPORTED_VERSION".into()); }
    if doc.revision != expected || expected.as_ref().map_or(false, |s| s.len() != 32 || !s.bytes().all(|b| b.is_ascii_hexdigit())) { return Err("CONFLICT".into()); }
    let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
    let old: Option<String> = tx.query_row("SELECT revision FROM f1_saved_models WHERE id=?1", [&doc.id], |r| r.get(0)).optional().map_err(|e| e.to_string())?;
    if old != expected { return Err("CONFLICT".into()); }
    if old.is_some() && !allow_v3 && stored(&tx, &doc.id)?.1.document_version != 2 { return Err("UNSUPPORTED_VERSION".into()); }
    if old.is_none() && tx.query_row("SELECT count(*) FROM f1_saved_models", [], |r| r.get::<_, u32>(0)).map_err(|e| e.to_string())? >= 1000 { return Err("LIMIT_EXCEEDED".into()); }
    let rev: String = tx.query_row("SELECT lower(hex(randomblob(16)))", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    doc.revision = Some(rev.clone()); let value = serde_json::to_value(&doc).map_err(|_| invalid())?;
    tx.execute("INSERT INTO f1_saved_models VALUES (?1,?2,?3) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, document=excluded.document", rusqlite::params![doc.id, rev, value.to_string()]).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?; Ok(value)
}
pub fn delete(connection: &mut Connection, id: &str, expected: &str, allow_v3: bool) -> Result<()> {
    if id.is_empty() || id.len() > 128 || expected.len() != 32 || !expected.bytes().all(|b| b.is_ascii_hexdigit()) { return Err(invalid()); }
    let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
    let old: Option<String> = tx.query_row("SELECT revision FROM f1_saved_models WHERE id=?1", [id], |r| r.get(0)).optional().map_err(|e| e.to_string())?;
    match old { None => return Err("REVISION_MISSING".into()), Some(rev) if rev != expected => return Err("CONFLICT".into()), _ => () }
    if !allow_v3 && stored(&tx, id)?.1.document_version != 2 { return Err("UNSUPPORTED_VERSION".into()); }
    tx.execute("DELETE FROM f1_saved_models WHERE id=?1 AND revision=?2", rusqlite::params![id, expected]).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?; Ok(())
}
/// Caller owns the transaction; existing IDs, including edited defaults, are never overwritten.
pub fn restore_defaults(connection: &Connection) -> Result<usize> {
    let definitions = [("f1-default-teams", "Points by team", "pie", "team", None), ("f1-default-driver-team", "Points by driver and team", "table", "driver", Some("team"))];
    let mut count = 0;
    for (id, title, kind, x, series) in definitions {
        let exists: bool = connection.query_row("SELECT EXISTS(SELECT 1 FROM f1_saved_models WHERE id=?1)", [id], |r| r.get(0)).map_err(|e| e.to_string())?;
        if exists { continue; }
        if connection.query_row("SELECT count(*) FROM f1_saved_models", [], |r| r.get::<_, u32>(0)).map_err(|e| e.to_string())? >= 1000 { return Err("LIMIT_EXCEEDED".into()); }
        let (revision, now): (String, String) = connection.query_row("SELECT lower(hex(randomblob(16))), strftime('%Y-%m-%dT%H:%M:%fZ','now')", [], |r| Ok((r.get(0)?, r.get(1)?))).map_err(|e| e.to_string())?;
        let mut raw = json!({"documentVersion":2,"kind":"model","id":id,"revision":revision,"title":title,"datasetId":"f1.session_results","datasetSchemaVersion":"1","datasetSemanticVersion":"1","binding":{"policy":"latest","partitionIds":[]},"visualization":{"kind":kind,"x":x,"metric":{"metricId":"points","aggregation":"sum"},"series":series,"comparison":"season","runningSum":false},"filters":[],"createdAt":now,"updatedAt":now});
        if kind == "table" { raw["visualization"]["table"] = json!({"version":1,"columns":["driver","team","season","points"]}); }
        parse(raw.clone())?;
        connection.execute("INSERT INTO f1_saved_models VALUES (?1,?2,?3)", rusqlite::params![id, revision, raw.to_string()]).map_err(|e| e.to_string())?;
        count += 1;
    }
    Ok(count)
}
pub fn restore(connection: &mut Connection) -> Result<usize> {
    let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
    let count = restore_initial_defaults(&tx)?; tx.commit().map_err(|e| e.to_string())?; Ok(count)
}

pub fn restore_initial_defaults(connection: &Connection) -> Result<usize> { Ok(restore_defaults(connection)? + restore_cumulative_default(connection)?) }

pub fn restore_cumulative_default(connection: &Connection) -> Result<usize> {
    let id = "f1-default-cumulative";
    if connection.query_row("SELECT EXISTS(SELECT 1 FROM f1_saved_models WHERE id=?1)", [id], |r| r.get::<_, bool>(0)).map_err(|e| e.to_string())? { return Ok(0); }
    if connection.query_row("SELECT count(*) FROM f1_saved_models", [], |r| r.get::<_, u32>(0)).map_err(|e| e.to_string())? >= 1000 { return Err("LIMIT_EXCEEDED".into()); }
    let (revision, now): (String, String) = connection.query_row("SELECT lower(hex(randomblob(16))), strftime('%Y-%m-%dT%H:%M:%fZ','now')", [], |r| Ok((r.get(0)?, r.get(1)?))).map_err(|e| e.to_string())?;
    let raw = json!({"documentVersion":3,"kind":"model","id":id,"revision":revision,"title":"Driver cumulative points","datasetId":"f1.session_results","datasetSchemaVersion":"1","datasetSemanticVersion":"1","binding":{"policy":"latest","partitionIds":[]},"visualization":{"kind":"bar","x":"round","metric":{"metricId":"points","aggregation":"sum"},"series":"driver","comparison":"season","extraDimensions":["session"],"runningSum":true,"calculation":{"version":3,"profileId":"driver-all-sessions-v1"}},"filters":[],"createdAt":now,"updatedAt":now});
    parse(raw.clone())?;
    connection.execute("INSERT INTO f1_saved_models VALUES (?1,?2,?3)", rusqlite::params![id, revision, raw.to_string()]).map_err(|e| e.to_string())?;
    Ok(1)
}
