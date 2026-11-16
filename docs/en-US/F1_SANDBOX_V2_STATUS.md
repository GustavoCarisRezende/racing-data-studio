# F1 Sandbox v2 integration — staged status record

## Current behavior

The F1 adapter and v3 profiles are integrated; `latest` models resolve active snapshots. References to blockers and missing validation below record the indicated stages, not necessarily current outstanding work.

The F1 adapter resolves `latest` again from local snapshots each time a model is opened, accepts an explicit season list, and retains already resolved selections. A requested missing season causes an error. Multiselection uses facets and preserves season in series identity. Pie and scatter charts use existing metrics (sum of reported points and occurrence count); both metrics are calculated in the same grouped query. The result is not official standings. V1 analyses remain pinned to their original revisions.

The store uses its own SQLite table, optimistic revisions, and `latest` binding. New databases receive three models: cumulative driver points as bars, team points as a pie, and driver/team/season points as a table. Deletions are not automatically reversed. The restore button inserts only missing defaults without overwriting existing ones; at that stage the editor list needed refreshing afterward. Deleting a model does not change v1 analyses or snapshots. There is a 1,000-model limit; restoration fails atomically if space is insufficient. Models do not store snapshot data; opening fails if a bound season no longer exists.

The F1 v3 profile calculates observed points by driver and season in session order before restricting round and session. Null points propagate; missing events are not fabricated as zero. Team filtering is rejected in accumulated queries to avoid losing points earned earlier with another team. Other population filters may exclude results. This sum is not official standings.

For **Points after event**, **Group by** switches between driver and team. Grouped by team, each series is still also identified by driver, season, and session: the value is that driver's accumulation through that session, not a team total. Switching teams does not restart the sum. Driver accumulations are not added together, and continuity between teams is not assumed. If a driver has results associated with different teams in the same session, the order is ambiguous and the query is rejected. The X axis remains round. Missing/tied times and null points retain the previous profile's rules; team filtering remains blocked for accumulations to avoid excluding earlier points. Old models are unchanged; the new profile has its own ID and is saved only after an explicit choice. Migration 8 only versions support and does not rewrite documents or snapshots.

### Earlier v1/v2 protocol blocker

At this stage, the contract allowed `displayFilters` only on the window axis. The editor moved only that axis filter after the window; session and team filters remained in `filters`, excluding occurrences **before** summation. Selecting only race therefore could not mean both “show races” and “include earlier sprints” in that contract. Moreover, a three-dimension limit could not distinguish round, session, driver, and season in the same grouping. Aggregating by round before the window could not show separate sprint and race values for that round. Silently changing filter application order would also break the generic contract and existing analyses.

SQLite stores original calendar pages; projection exposes race/sprint round and date/time as provided. The v3 profile requires a valid date and UTC time with seconds for each participating observation. A missing time, missing driver, or temporal tie for the same driver/season returns `ORDER_UNAVAILABLE`, even when the observation lies outside the displayed range. This may prevent use with historical seasons lacking times; there is no fallback to assumed order. Calendar metadata does not guarantee complete results.

Adapter tests used synthetic fixtures only. At this stage, there had been no Tauri visual test or CSP, accessibility, or performance validation of this v3 integration.

### Library response to the blocker — opt-in v3 contract

The library then provided query v3 with provider-defined `runningSumProfiles`: round/driver/season/session grain, driver/season-only partitioning, and declared post-calculation slicing fields (round **and** session). No F1 rule or chronological assumption was introduced into the core. V1/v2 preserve their behavior. The library test looking for a season dropdown was updated to checkbox facets; the synthetic capture scenario was also adapted.

The host provides `AnalysisStore.modelsV3`; migration 7 fully preserves existing models and snapshots without reinstalling deleted defaults. Missing defaults in older databases can be added through explicit restoration. The old v2 collection neither lists nor modifies v3 models. Upgrading a v2 model to v3 happens only through explicit editing and saving. Interfaces, pipeline, and limits: [SANDBOX_V3_ACCUMULATION.md](SANDBOX_V3_ACCUMULATION.md).

### Integrated management/UI — November 12, 2026

Restoration is now a `SandboxHostServices` capability, presented in the same manager as persisted models with automatic list refresh. The duplicate external button was removed from `analysis-screen.tsx`. The provider only gained a localized `measureLabel` to present the existing v3 profile as **Points after event**, without changing its algorithm or saved models. No SQL/migration changes in this round. Reference, pie diagnosis, clean-state regression, and validation: [SANDBOX_UI_RECOVERY.md](SANDBOX_UI_RECOVERY.md).
