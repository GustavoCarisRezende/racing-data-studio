# Handoff: running totals by profile — query/model v3

> **Historical context:** This document records a proposal, contract or review from its time; statements about status, outstanding work and tests are not necessarily current. See [development](DEVELOPMENT.md) and the [user guide](USER_GUIDE.md) for current behavior and implementation differences. The historical text is retained below.

> The current presentation uses the profile as a **selectable metric**, not a technical profile selector. The v3 contract/pipeline below is preserved. See [SANDBOX_UI_RECOVERY.md](SANDBOX_UI_RECOVERY.md) for `measureLabel`, unified management and the two essential F1 host adjustments.

An extension of the **library**, in response to `F1_SANDBOX_V2_STATUS.md`. It does not implement or enable F1 calculation in `app/`. New tests use invented orchard visits and injected chronology. No real database is accessed.

## 1. Opt-in and provider interface

`DatasetDescriptor.protocolVersion` remains `1`. New capabilities:

```ts
queryVersions: [1, 2, 3],
maxDimensions: 4, // or greater, up to 10
runningSum: true,
runningSumProfiles: RunningSumProfile[],
```

Type exported from `packages/sandbox-contracts/src/index.ts`:

```ts
interface RunningSumProfile {
  version: 1;
  id: string;
  label: LocalizedText;
  description: LocalizedText;
  metricId: string;
  axisFieldId: string;
  dimensions: string[];
  partitionBy: string[];
  orderDimensions: string[];
  chronology: { id: string; missing: 'reject' };
  displayFilterFields: string[];
}
```

Validated rules:
- Dimensions are available, unique, within `maxDimensions`, and allowed by `metric.groupableBy`. The metric is additive, with `sum` and `supportsRunningSum: true`.
- `partitionBy` and `orderDimensions` are nonempty and disjoint, with a union exactly equal to `dimensions`. If `multiSelection` exists, its field belongs to the partition.
- `axisFieldId` is an ordered dimension within `orderDimensions`. Other order fields may be nominal codes; **lexical order of those codes is not used**.
- All filters on `displayFilterFields` must be post-calculation, whether from a preset, facet or advanced editor. Those fields belong to the grain and are prohibited in `query.filters`, even without an equivalent display filter.
- `chronology.id` identifies a real provider algorithm/version, which the library does not execute. `missing: 'reject'` requires `ORDER_UNAVAILABLE` if any participating observation cannot be ordered unambiguously, including outside the displayed slice. Do not break ties by ID/import order or invent times.

Profile/chronology IDs are **semantically immutable**. Changing a rule requires a new ID or dataset semantic version. The provider omits unimplemented profiles and rejects infeasible selections at runtime when coverage is partial; it does not promise missing data. Retain already supported legacy `runningSumScopes` and query versions: `runningSumProfiles` does not replace or reinterpret those older contracts.

## 2. Example for Terra — no F1 rule in the core

After implementing/testing the provider, it can advertise:

```ts
{
  version: 1,
  id: 'driver-all-sessions-v1',
  label: { fallback: 'Pontos acumulados por piloto/temporada' },
  description: { fallback: 'Todas as sessões anteriores; rodada e sessão só recortam a exibição. Não é classificação oficial.' },
  metricId: 'points', axisFieldId: 'round',
  dimensions: ['round', 'driver', 'season', 'session'],
  partitionBy: ['driver', 'season'],
  orderDimensions: ['round', 'session'],
  chronology: { id: 'validated-local-session-calendar-v1', missing: 'reject' },
  displayFilterFields: ['round', 'session'],
}
```

`points.groupableBy` must allow all four dimensions. Do not silently add `session` to the old metric's `requiredDimensions`: the new profile fixes the grain. A validated real calendar determines order. `orderDimensions` identifies the observation; it does not order session codes or assume sprint always precedes race. Missing/ambiguous time produces an error, not fallback to round/ID.

Showing only the race in round 5 includes all earlier participating sessions for the driver in that season, including earlier sprints and the same round's sprint if chronologically earlier. It excludes later sessions. Showing only sprint also includes earlier races, without restarting by session. Drivers/seasons are not summed together. The provider defines/tests expected coverage, duplicates and nulls; an available time does not imply an available result, and a missing result is not zero.

Team/other fields remain population filters unless declared as display filters. The UI explains the separation. To make them display filters, publish a corresponding profile/grain without changing the meaning of an already saved profile.

## 3. Query/result v3 and required order

```ts
{
  protocolVersion: 3,
  // requestId, datasetId/schemaVersion/semanticVersion/selection as before
  dimensions: ['round', 'driver', 'season', 'session'],
  metrics: [{ metricId: 'points', aggregation: 'sum' }],
  filters: [{ fieldId: 'season', op: 'in', values: ['2024', '2025'] }],
  displayFilters: [
    { fieldId: 'round', op: 'range', min: 5, max: 10 },
    { fieldId: 'session', op: 'in', values: ['results'] },
  ],
  window: {
    kind: 'runningSum', metricId: 'points', scope: 'profile',
    profileId: 'driver-all-sessions-v1',
    orderBy: 'round', // DISPLAYED axis; effective chronology comes from the profile!
    partitionBy: ['driver', 'season'],
  },
  orderBy: [{ fieldId: 'round', direction: 'asc' }],
  limit: 5000,
}
```

Validate with `assertQuery(q, descriptor)`: grain, partition, axis and metric must match the profile. `displayFilters` accepts only declared fields. V3 accepts neither a legacy window nor an unknown profile. The response repeats `protocolVersion: 3`, requestId and selectionToken, with one row per **complete** four-dimension key.

```text
consistent selection/revisions → population filters
→ aggregate occurrences by all dimensions
→ validate chronology of ALL participating observations
→ accumulate in profile chronology, restarting ONLY by partitionBy
→ apply displayFilters to already accumulated rows
→ sort presentation by query.orderBy → check limit/complete/totalRows
```

Do not filter round/session or limit rows before the window. Descending presentation order does not reverse calculation. Decimals remain exact; an earlier null does not become zero. `ORDER_UNAVAILABLE` does not become an empty result or partial sum. Facets remain v1 for choosing values; facet filters do not define the window population.

## 4. UI/core and fourth dimension

`VisualizationSpec` extensions, exclusive to v3 configuration/models:

```ts
extraDimensions?: string[];
calculation?: { version: 3; profileId: string };
```

- `visualizationDimensions(v)` = X + series + comparison + extras, up to capacity.
- `withCalculationProfile(d, v, profileId)` is an **explicit** action, not used on opening an old document. It sets axis/metric/grain, enables the window, removes legacy scope/secondary measure and resets column configuration.
- `configurationQuery` and `buildQuery` share routing and validation. Presets, facets and advanced filters for Session have the same post-calculation semantics.
- On the right, choosing a profile fixes fields/aggregation. The filter area identifies display-only fields and active input filters. Leaving the profile is explicit: it removes window/extras; filters remain selected and become population filters again.
- Extras without a window permit v3 queries with more than three dimensions. To accumulate them, use a profile, not a legacy v1/v2 window.
- Table/preview/sorting/export retain the fourth dimension. In line/bar with a Round axis, session identifies **visual subseries**: the renderer does not sum sessions, merge two cells in the same round or restart the calculation partition. A single temporal axis per observation requires another provider field/profile; the library does not create timestamps.

## 5. Persistence — exact interface, without breaking the v2 store

`SavedModelDocumentV3` has `documentVersion: 3`, with the rest of the latest envelope like v2. `ModelDocument = SavedModelDocument | SavedModelDocumentV3`.

```ts
interface SavedModelStoreV3 {
  documentVersion: 3;
  list(signal?: AbortSignal): Promise<AnalysisSummary[]>;
  load(id: string, signal?: AbortSignal): Promise<unknown>;
  save(document: ModelDocument, expectedRevision: string | null,
       signal?: AbortSignal): Promise<ModelDocument>;
  delete(request: { id: string; expectedRevision: string },
         signal?: AbortSignal): Promise<void>;
}
// New optional property: AnalysisStore.modelsV3?: SavedModelStoreV3
```

The v3 store reads **v2 and v3** in the same collection, preserving version/content and CAS. The UI prefers `modelsV3`. The backend must validate/retain new fields; advertising marker 3 in a wrapper whose Rust validator still discards fields is insufficient. The old `models` path remains exclusive to v2, without listing/overwriting v3 documents for an old client. Do not duplicate records or migrate on open. Update v2 to v3 only through explicit action (choose profile and save), with the previous revision.

Use `makeModelV3`, `parseModelDocumentV3` or `parseSavedModelDocument` (accepts 2/3). `parseModelDocument` remains exclusive to v2 and rejects v3; it also rejects v3 fields disguised under version 2. `PROFILE_MODEL_DOCUMENT_VERSION` is 3; old constants `PROTOCOL_VERSION`, `DOCUMENT_VERSION` and `MODEL_DOCUMENT_VERSION` do not change.

Without `modelsV3`, querying/exploring a profile remains possible if the provider allows it, but saving is unavailable with a warning. No fallback to v2, pinned or localStorage. Latest, limits and CAS retain v2 guarantees. The example v3 store is volatile and accepts both documents; adapting/persisting the real collection is the host's task.

## 6. Compatibility, tests and integration notice

- V1 retains filters before summation and partitioning by all other dimensions.
- V2 retains only the axis post-calculation: Session remains population. V2 models do not receive a profile/fourth dimension or change results when opened under a v3 provider.
- V3 requires opt-in and a new document/configuration, without implicit upgrade.
- `tests/studio.test.mjs` now uses season multiselection via checkboxes; synthetic preview `?selected` was also adapted to the current control.
- `tests/v3.test.mjs`: multiple display filters, pre-window aggregation, non-lexical chronology, partitions, descending order, nulls, missing order outside the slice/ties, versions, permissions, extra grain and CAS/persistence.
- `tests/v3-ui.test.mjs`: profile, fourth dimension, input/display filters, accumulated values, v2 store blocking and saving/opening latest v3.

**Terra still needs to implement** the F1 profile/chronology/coverage, native v3 store, backend/IPC tests and enabling real capabilities. This delivery does not change `app/`, SQLite, personal data or default models, nor claim running totals are already active in the application. Tauri/WebKitGTK, screen readers, real history/calendar and native performance remain outside synthetic library validation.
