//! Jolpica compatible API. Keep the source responses intact: historical results can
//! contain shared drives, missing constructors and other exceptional cases.
use serde_json::Value;
use std::{collections::{BTreeMap, HashSet, VecDeque}, io::Read, sync::{Mutex, OnceLock}, thread, time::{Duration, Instant}};

#[derive(Debug)]
pub struct Page {
    pub endpoint: &'static str,
    pub offset: usize,
    pub payload: String,
}

const MAX_ITEMS: usize = 100_000;
const MAX_PAGE_BYTES: u64 = 4 * 1024 * 1024;
const MAX_ENDPOINT_BYTES: usize = 64 * 1024 * 1024;
const MAX_PAGES: usize = 4096;

fn number(value: &Value, field: &str) -> Result<usize, String> {
    value.get(field).and_then(Value::as_str).and_then(|v| v.parse().ok())
        .ok_or_else(|| format!("Invalid pagination field: {field}"))
}

// `total` and offsets count results for result endpoints, but races for calendar.
fn collect_endpoint<F>(year: u16, endpoint: &'static str, mut fetch: F) -> Result<Vec<Page>, String>
where F: FnMut(usize) -> Result<String, String> {
    let mut pages = Vec::new();
    let mut offset = 0;
    let mut expected_total = None;
    let mut expected_limit = None;
    let mut seen = HashSet::new();
    let mut bytes = 0usize;
    loop {
        if pages.len() >= MAX_PAGES { return Err("Too many pages; no data saved".into()); }
        let payload = fetch(offset)?;
        bytes = bytes.checked_add(payload.len()).ok_or("Response size overflow")?;
        if payload.len() as u64 > MAX_PAGE_BYTES || bytes > MAX_ENDPOINT_BYTES { return Err("Response too large; no data saved".into()); }
        let root: Value = serde_json::from_str(&payload).map_err(|e| format!("Invalid JSON: {e}"))?;
        let data = root.get("MRData").ok_or("Missing MRData")?;
        if data.get("series").and_then(Value::as_str) != Some("f1") { return Err("Invalid series".into()); }
        let total = number(data, "total")?;
        let limit = number(data, "limit")?;
        if number(data, "offset")? != offset || limit == 0 || limit > 100 || total > MAX_ITEMS || expected_total.is_some_and(|v| v != total) || expected_limit.is_some_and(|v| v != limit) {
            return Err("Inconsistent pagination; no data saved".into());
        }
        expected_total = Some(total);
        expected_limit = Some(limit);
        let table = data.get("RaceTable").ok_or("Missing RaceTable")?;
        if table.get("season").and_then(Value::as_str) != Some(&year.to_string()) { return Err("Unexpected season".into()); }
        let races = table.get("Races").and_then(Value::as_array).ok_or("Missing races")?;
        let mut count = 0;
        for race in races {
            if race.get("season").and_then(Value::as_str) != Some(&year.to_string()) { return Err("Unexpected race season".into()); }
            let round = race.get("round").and_then(Value::as_str).and_then(|s| s.parse::<u16>().ok()).filter(|n| *n > 0).ok_or("Invalid round")?;
            if race.get("raceName").and_then(Value::as_str).is_none_or(str::is_empty) || race.pointer("/Circuit/circuitId").and_then(Value::as_str).is_none_or(str::is_empty) || race.get("date").and_then(Value::as_str).is_none_or(str::is_empty) { return Err("Incomplete race".into()); }
            if endpoint == "races" {
                if !seen.insert(round.to_string()) { return Err("Duplicate calendar round".into()); }
                count += 1;
            } else {
                let key = if endpoint == "results" { "Results" } else { "SprintResults" };
                let results = race.get(key).and_then(Value::as_array).filter(|r| !r.is_empty()).ok_or("Missing results")?;
                for result in results {
                    if result.pointer("/Driver/driverId").and_then(Value::as_str).is_none_or(str::is_empty) || result.get("positionText").and_then(Value::as_str).is_none_or(str::is_empty) || result.get("points").and_then(Value::as_str).is_none() { return Err("Incomplete result".into()); }
                    // Identical source records are ambiguous; reject rather than discard one.
                    if !seen.insert(format!("{round}:{}", result)) { return Err("Duplicate result".into()); }
                    count += 1;
                }
            }
        }
        if count > limit || offset + count > total || (count == 0 && offset < total) { return Err("Incomplete page".into()); }
        pages.push(Page { endpoint, offset, payload });
        offset += count;
        if offset == total { break; }
    }
    if endpoint == "races" && offset == 0 { return Err("Empty calendar; no data saved".into()); }
    Ok(pages)
}

#[derive(Debug, PartialEq, Eq)]
struct RaceIdentity {
    name: String,
    circuit: String,
    date: String,
}

/// Multiplicity per driver allows shared drives without assuming a unique driver
/// per session. This detects some regressions but does not establish completeness.
#[derive(Debug, Default)]
pub(crate) struct Coverage {
    calendar: BTreeMap<u16, RaceIdentity>,
    race_results: BTreeMap<u16, usize>,
    sprint_results: BTreeMap<u16, usize>,
    race_drivers: BTreeMap<(u16, String), usize>,
    sprint_drivers: BTreeMap<(u16, String), usize>,
}

impl Coverage {
    pub(crate) fn check_not_reduced(&self, previous: &Self) -> Result<(), String> {
        for round in previous.calendar.keys() {
            if !self.calendar.contains_key(round) {
                return Err(format!("Calendar round {round} disappeared; previous snapshot retained"));
            }
        }
        for (label, old, new) in [
            ("race", &previous.race_results, &self.race_results),
            ("sprint", &previous.sprint_results, &self.sprint_results),
        ] {
            for (round, count) in old {
                if new.get(round).copied().unwrap_or(0) < *count {
                    return Err(format!("Fewer {label} results for round {round}; previous snapshot retained"));
                }
            }
        }
        for (label, old, new) in [
            ("race", &previous.race_drivers, &self.race_drivers),
            ("sprint", &previous.sprint_drivers, &self.sprint_drivers),
        ] {
            for ((round, driver), count) in old {
                if new.get(&(*round, driver.clone())).copied().unwrap_or(0) < *count {
                    return Err(format!("Missing {label} result for driver {driver}, round {round}; previous snapshot retained"));
                }
            }
        }
        Ok(())
    }
}

/// Revalidate at the persistence boundary, not just during network collection.
/// Result pages may split one race across multiple pages; count results, not races.
pub(crate) fn validate_pages(year: u16, pages: &[Page]) -> Result<Coverage, String> {
    if !(1950..=2100).contains(&year) { return Err("Season must be between 1950 and 2100".into()); }
    if pages.iter().any(|p| !["races", "results", "sprint"].contains(&p.endpoint)) {
        return Err("Unexpected endpoint".into());
    }
    let mut coverage = Coverage::default();
    for endpoint in ["races", "results", "sprint"] {
        let selected: Vec<_> = pages.iter().filter(|p| p.endpoint == endpoint).collect();
        let mut index = 0;
        collect_endpoint(year, endpoint, |offset| {
            let page = selected.get(index).ok_or_else(|| format!("Missing {endpoint} page at offset {offset}"))?;
            if page.offset != offset { return Err(format!("Unexpected {endpoint} page offset")); }
            index += 1;
            Ok(page.payload.clone())
        })?;
        if index != selected.len() { return Err(format!("Extra {endpoint} pages")); }

        for page in selected {
            let root: Value = serde_json::from_str(&page.payload).map_err(|e| e.to_string())?;
            let races = root["MRData"]["RaceTable"]["Races"].as_array().ok_or("Missing races")?;
            for race in races {
                // Already checked by collect_endpoint.
                let round = race["round"].as_str().and_then(|s| s.parse::<u16>().ok()).ok_or("Invalid round")?;
                let identity = RaceIdentity {
                    name: race["raceName"].as_str().ok_or("Missing race name")?.to_owned(),
                    circuit: race["Circuit"]["circuitId"].as_str().ok_or("Missing circuit")?.to_owned(),
                    date: race["date"].as_str().ok_or("Missing date")?.to_owned(),
                };
                if endpoint == "races" {
                    coverage.calendar.insert(round, identity);
                } else {
                    match coverage.calendar.get(&round) {
                        None => return Err(format!("{endpoint} round {round} is absent from calendar")),
                        Some(calendar) if *calendar != identity => return Err(format!("{endpoint} round {round} disagrees with calendar (name, circuit or date)")),
                        _ => {}
                    }
                    let (key, counts, drivers) = if endpoint == "results" {
                        ("Results", &mut coverage.race_results, &mut coverage.race_drivers)
                    } else {
                        ("SprintResults", &mut coverage.sprint_results, &mut coverage.sprint_drivers)
                    };
                    let results = race[key].as_array().ok_or("Missing results")?;
                    *counts.entry(round).or_default() += results.len();
                    for result in results {
                        let driver = result.pointer("/Driver/driverId").and_then(Value::as_str).ok_or("Missing driver")?;
                        *drivers.entry((round, driver.to_owned())).or_default() += 1;
                    }
                }
            }
        }
    }
    Ok(coverage)
}

fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent(concat!("RacingDataStudio/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(30)).redirect(reqwest::redirect::Policy::none())
        .build().map_err(|e| e.to_string())
}

// Process-wide pacing shared by catalog and imports. The provider's limits are
// shared with other processes on the same IP and cannot be guaranteed here.
#[derive(Default)]
struct RateState { requests: VecDeque<Instant>, blocked_until: Option<Instant>, unknown_cooldown: bool }
fn rate_state() -> &'static Mutex<RateState> {
    static RATE: OnceLock<Mutex<RateState>> = OnceLock::new();
    RATE.get_or_init(|| Mutex::new(RateState::default()))
}
fn pace() -> Result<(), String> {
    let mut state = rate_state().lock().map_err(|_| "Rate limiter unavailable")?;
    if state.unknown_cooldown { return Err("Jolpica returned an unparseable Retry-After; restart only after the requested wait".into()); }
    if state.blocked_until.is_some_and(|until| Instant::now() < until) { return Err("Jolpica cooldown active; wait before retrying".into()); }
    while state.requests.front().is_some_and(|t| t.elapsed() >= Duration::from_secs(3600)) { state.requests.pop_front(); }
    if state.requests.len() >= 450 { return Err("Local hourly request limit reached; wait before retrying".into()); }
    if let Some(last) = state.requests.back() {
        if let Some(wait) = Duration::from_millis(300).checked_sub(last.elapsed()) { thread::sleep(wait); }
    }
    state.requests.push_back(Instant::now());
    Ok(())
}

fn short_retry_delay(header: &str, attempt: usize) -> Option<Duration> {
    let seconds = header.parse::<u64>().ok()?;
    (attempt < 2 && seconds <= 10).then(|| Duration::from_millis(seconds.max(1) * 1000 + 10))
}

fn fetch(client: &reqwest::blocking::Client, url: &str) -> Result<String, String> {
    for attempt in 0..3 {
        pace()?;
        let response = match client.get(url).send() {
            Ok(response) => response,
            Err(error) if attempt < 2 && (error.is_timeout() || error.is_connect()) => {
                thread::sleep(Duration::from_secs(1 << attempt));
                continue;
            }
            Err(error) => return Err(format!("Network error: {error}")),
        };
        let status = response.status();
        if status.as_u16() == 429 {
            let retry = response.headers().get(reqwest::header::RETRY_AFTER).and_then(|h| h.to_str().ok()).unwrap_or("");
            // Never retry earlier than requested; long or HTTP-date delays are left to the user.
            let seconds = retry.parse::<u64>().ok();
            if let Ok(mut state) = rate_state().lock() {
                match seconds {
                    Some(delay) => match Instant::now().checked_add(Duration::from_secs(delay.max(1))) {
                        Some(until) => state.blocked_until = Some(until),
                        None => state.unknown_cooldown = true,
                    },
                    None => state.unknown_cooldown = true,
                }
            }
            if let Some(delay) = short_retry_delay(retry, attempt) {
                thread::sleep(delay);
                continue;
            }
            return Err(format!("Jolpica HTTP 429. Retry-After: {}. Please wait before retrying.", if retry.is_empty() { "unknown" } else { retry }));
        }
        if status.is_server_error() && attempt < 2 { thread::sleep(Duration::from_secs(1 << attempt)); continue; }
        if !status.is_success() { return Err(format!("Jolpica HTTP error: {status}")); }
        let mut body = String::new();
        if let Err(error) = response.take(MAX_PAGE_BYTES + 1).read_to_string(&mut body) {
            if attempt < 2 && error.kind() != std::io::ErrorKind::InvalidData { thread::sleep(Duration::from_secs(1 << attempt)); continue; }
            return Err(format!("Response read error: {error}"));
        }
        if body.len() as u64 > MAX_PAGE_BYTES { return Err("Response too large".into()); }
        return Ok(body);
    }
    Err("Request retries exhausted".into())
}

fn collect_seasons<F: FnMut(usize) -> Result<String, String>>(mut get: F) -> Result<Vec<u16>, String> {
    let mut years = Vec::new();
    let mut expected = None;
    let mut expected_limit = None;
    loop {
        let offset = years.len();
        let payload = get(offset)?;
        if payload.len() as u64 > MAX_PAGE_BYTES { return Err("Season catalog page too large".into()); }
        let root: Value = serde_json::from_str(&payload).map_err(|e| e.to_string())?;
        let data = root.get("MRData").ok_or("Missing MRData")?;
        let total = number(data, "total")?;
        let limit = number(data, "limit")?;
        if data.get("series").and_then(Value::as_str) != Some("f1") || number(data, "offset")? != offset || total == 0 || total > 1000 || limit == 0 || limit > 100 || expected.is_some_and(|v| v != total) || expected_limit.is_some_and(|v| v != limit) { return Err("Inconsistent season catalog pagination".into()); }
        expected = Some(total); expected_limit = Some(limit);
        let seasons = data.pointer("/SeasonTable/Seasons").and_then(Value::as_array).ok_or("Missing seasons")?;
        if seasons.is_empty() || seasons.len() > limit || offset + seasons.len() > total { return Err("Incomplete season catalog".into()); }
        for season in seasons {
            let year = season.get("season").and_then(Value::as_str).and_then(|s| s.parse::<u16>().ok()).filter(|y| (1950..=2100).contains(y)).ok_or("Invalid season year")?;
            if years.last().is_some_and(|previous| *previous >= year) { return Err("Duplicate or unordered season catalog".into()); }
            years.push(year);
        }
        if years.len() == total { return Ok(years); }
    }
}

pub fn seasons() -> Result<Vec<u16>, String> {
    let client = client()?;
    collect_seasons(|offset| fetch(&client, &format!("https://api.jolpi.ca/ergast/f1/seasons.json?limit=100&offset={offset}")))
}

pub fn download<F: FnMut(&'static str, usize)>(year: u16, mut progress: F) -> Result<Vec<Page>, String> {
    if !(1950..=2100).contains(&year) { return Err("Season must be between 1950 and 2100".into()); }
    let client = client()?;
    let mut pages = Vec::new();
    for endpoint in ["races", "results", "sprint"] {
        pages.extend(collect_endpoint(year, endpoint, |offset| {
            progress(endpoint, offset);
            let url = format!("https://api.jolpi.ca/ergast/f1/{year}/{endpoint}.json?limit=100&offset={offset}");
            fetch(&client, &url)
        })?);
    }
    validate_pages(year, &pages)?;
    Ok(pages)
}

#[cfg(test)]
pub(crate) mod fixtures {
    use super::*;
    use serde_json::json;

    pub fn race(round: u16) -> Value {
        json!({"season":"2024","round":round.to_string(),"raceName":format!("Synthetic {round}"),"Circuit":{"circuitId":format!("c{round}")},"date":"2024-03-01"})
    }
    pub fn result_race(round: u16, endpoint: &str, drivers: &[&str]) -> Value {
        let mut race = race(round);
        let results: Vec<_> = drivers.iter().enumerate().map(|(i, driver)| json!({"Driver":{"driverId":driver},"positionText":(i+1).to_string(),"points":"1"})).collect();
        race[if endpoint == "results" { "Results" } else { "SprintResults" }] = json!(results);
        race
    }
    pub fn page(endpoint: &'static str, offset: usize, total: usize, races: Vec<Value>) -> Page {
        Page { endpoint, offset, payload: json!({"MRData":{"series":"f1","limit":"100","offset":offset.to_string(),"total":total.to_string(),"RaceTable":{"season":"2024","Races":races}}}).to_string() }
    }
    pub fn season(rounds: &[u16], drivers: &[&str]) -> Vec<Page> {
        let results = if drivers.is_empty() { vec![] } else { vec![result_race(1, "results", drivers)] };
        vec![page("races", 0, rounds.len(), rounds.iter().map(|r| race(*r)).collect()), page("results", 0, drivers.len(), results), page("sprint", 0, 0, vec![])]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::fixtures::*;

    #[test]
    fn season_catalog_pagination_and_invalid_responses() {
        let catalog = |offset: usize, total: usize, years: &[u16]| serde_json::json!({"MRData":{"series":"f1","limit":"100","offset":offset.to_string(),"total":total.to_string(),"SeasonTable":{"Seasons": years.iter().map(|y| serde_json::json!({"season":y.to_string()})).collect::<Vec<_>>()}}}).to_string();
        assert_eq!(collect_seasons(|offset| Ok(if offset == 0 { catalog(0, 2, &[1950]) } else { catalog(1, 2, &[1951]) })).unwrap(), vec![1950, 1951]);
        assert!(collect_seasons(|offset| Ok(catalog(offset, 2, &[1950]))).is_err());
        assert!(collect_seasons(|offset| Ok(if offset == 0 { catalog(0, 2, &[1950]) } else { catalog(1, 3, &[1951]) })).is_err());
        assert!(collect_seasons(|_| Err("offline".into())).is_err());
    }

    #[test]
    fn retry_after_only_retries_bounded_numeric_delays() {
        assert!(short_retry_delay("2", 0).unwrap() >= Duration::from_secs(2));
        assert!(short_retry_delay("0", 1).unwrap() >= Duration::from_secs(1));
        assert!(short_retry_delay("11", 0).is_none());
        assert!(short_retry_delay("2", 2).is_none());
        assert!(short_retry_delay("Wed, 21 Oct 2030 07:28:00 GMT", 0).is_none());
        assert!(short_retry_delay("", 0).is_none());
    }

    #[test]
    #[ignore = "optional read-only network smoke test; not part of offline test suite"]
    fn live_read_only_smoke() {
        let years = seasons().unwrap();
        assert!(years.contains(&2024));
        let pages = download(2024, |_, _| {}).unwrap();
        let coverage = validate_pages(2024, &pages).unwrap();
        assert!(!coverage.calendar.is_empty());
        assert!(!coverage.race_results.is_empty());
    }

    #[test]
    fn calendar_and_split_results_pagination() {
        let pages = vec![
            page("races", 0, 2, vec![race(1)]), page("races", 1, 2, vec![race(2)]),
            page("results", 0, 2, vec![result_race(1, "results", &["a"])]),
            page("results", 1, 2, vec![result_race(1, "results", &["b"])]),
            page("sprint", 0, 0, vec![]),
        ];
        let coverage = validate_pages(2024, &pages).unwrap();
        assert_eq!(coverage.race_results.get(&1), Some(&2));
        assert!(!coverage.race_results.contains_key(&2)); // Future or unavailable, not an error.
    }

    #[test]
    fn cross_endpoint_season_round_and_metadata() {
        let mut pages = season(&[1, 2], &["a"]);
        assert!(validate_pages(2024, &pages).is_ok());
        pages[1] = page("results", 0, 1, vec![result_race(3, "results", &["a"])]);
        assert!(validate_pages(2024, &pages).unwrap_err().contains("absent from calendar"));
        pages[1] = page("results", 0, 0, vec![]);
        pages[2] = page("sprint", 0, 1, vec![result_race(3, "sprint", &["a"])]);
        assert!(validate_pages(2024, &pages).unwrap_err().contains("absent from calendar"));
        let mut mismatched = result_race(1, "sprint", &["a"]);
        mismatched["Circuit"]["circuitId"] = "other".into();
        pages[2] = page("sprint", 0, 1, vec![mismatched]);
        assert!(validate_pages(2024, &pages).unwrap_err().contains("disagrees"));
        let mut wrong_result_year = result_race(1, "results", &["a"]);
        wrong_result_year["season"] = "2023".into();
        pages[1] = page("results", 0, 1, vec![wrong_result_year]);
        assert!(validate_pages(2024, &pages).unwrap_err().contains("race season"));
        let mut wrong_year = race(1);
        wrong_year["season"] = "2023".into();
        pages[0] = page("races", 0, 1, vec![wrong_year]);
        assert!(validate_pages(2024, &pages).is_err());
        assert!(validate_pages(2023, &season(&[1], &[])).is_err());
    }

    #[test]
    fn pagination_failures_and_duplicates() {
        let mut pages = season(&[1], &[]);
        pages[0] = page("races", 0, 2, vec![race(1), race(1)]);
        assert!(validate_pages(2024, &pages).is_err());
        let mut alias = race(1); alias["round"] = "01".into();
        pages[0] = page("races", 0, 2, vec![race(1), alias]);
        assert!(validate_pages(2024, &pages).is_err());
        pages[0] = page("races", 0, 2, vec![race(1)]);
        assert!(validate_pages(2024, &pages).is_err()); // Missing page
        pages.insert(1, page("races", 2, 2, vec![race(2)]));
        assert!(validate_pages(2024, &pages).is_err()); // Wrong offset
        pages[1] = page("races", 1, 3, vec![race(2)]);
        assert!(validate_pages(2024, &pages).is_err()); // Changed total
        pages[1] = page("races", 1, 2, vec![]);
        assert!(validate_pages(2024, &pages).is_err()); // Empty premature page
        pages[1] = page("races", 1, 2, vec![race(2)]);
        pages.insert(2, page("races", 2, 2, vec![]));
        assert!(validate_pages(2024, &pages).is_err()); // Extra page

        let mut second: Value = serde_json::from_str(&pages[1].payload).unwrap();
        second["MRData"]["limit"] = "99".into();
        pages[1].payload = second.to_string();
        pages.remove(2);
        assert!(validate_pages(2024, &pages).is_err()); // Changed limit
        second["MRData"]["limit"] = "100".into();
        second["MRData"]["offset"] = "0".into();
        pages[1].payload = second.to_string();
        assert!(validate_pages(2024, &pages).is_err()); // Offset in envelope differs
    }

    #[test]
    fn duplicate_results_and_failure_propagation() {
        let mut pages = season(&[1], &[]);
        let result = result_race(1, "results", &["a"]);
        pages[1] = page("results", 0, 2, vec![result.clone()]);
        pages.insert(2, page("results", 1, 2, vec![result]));
        assert!(validate_pages(2024, &pages).unwrap_err().contains("Duplicate result"));
        assert!(collect_endpoint(2024, "races", |_| Err("429".into())).is_err());
        assert!(collect_endpoint(2024, "races", |offset| if offset == 0 { Ok(page("races", 0, 2, vec![race(1)]).payload) } else { Err("429 on second page".into()) }).unwrap_err().contains("429"));
        assert!(collect_endpoint(2024, "races", |_| Ok("{}".into())).is_err());
        assert!(validate_pages(2024, &season(&[1], &[])).is_ok()); // Empty results and sprint allowed.
    }
}
