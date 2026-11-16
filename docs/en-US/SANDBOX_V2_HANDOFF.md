# Sandbox library — v2 handoff (10 November 2026)

> **Historical context:** This document records a proposal, contract or review from its time; statements about status, outstanding work and tests are not necessarily current. See [development](DEVELOPMENT.md) and the [user guide](USER_GUIDE.md) for current behavior and implementation differences. The historical text is preserved below.

> To include earlier sessions despite filtering by session/round, use the [v3 profile opt-in](SANDBOX_V3_ACCUMULATION.md). This document retains v2 behavior (only the axis is filtered after calculation), without reinterpreting old models.

Implementation was limited to `packages/` and library documentation. **It does not enable capabilities in the F1 adapter or create native persistence.** It does not read the user's database. Complete exported types are in `packages/sandbox-contracts/src/index.ts`; runtime validators are in `validation.ts` in the same directory.

## 1. Compatibility and independent versions

| Layer | Version / rule |
|---|---|
| Catalog, descriptor, selection, facets | `protocolVersion: 1`, with optional capabilities |
| Query/result | `1` normally; `2` for filtering after calculation; response repeats requested version |
| Old analysis | `documentVersion: 1`, pinned snapshots, original `AnalysisStore` |
| Model | `documentVersion: 2`, `kind: 'model'`, `latest` binding, `AnalysisStore.models` |
| Model table configuration | `table.version: 1` |

`PROTOCOL_VERSION` and `DOCUMENT_VERSION` remain `1` for old consumers. `MODEL_DOCUMENT_VERSION` is `2`. Absence of `models`/new capabilities preserves the old integration. There is no automatic migration, rewrite on open, autosave or conversion of a pinned analysis into a model. V1 does not accept pie/scatter or `secondaryMetric`, `table` or `cumulativeScope`: saving these features requires a model. Future versions and schema/semantic changes are rejected, not reinterpreted.

An old analysis retains its filters and grouping even if the descriptor has acquired multiselection. The React v1 open path uses `buildQuery(..., { legacyPinned: true })`. For **new** queries, `buildQuery` refuses to omit the multiselection dimension. `withRequiredDimensions` retains this dimension when creating/editing configurations. The first explicit configuration or filter edit can therefore add this grouping; opening alone never adds it. `assertQuery` does not retroactively impose this hint on old consumers' v1 queries. Intrinsic metric rules remain in `requiredDimensions` (do not change those rules without versioning existing document semantics).

## 2. Capabilities Terra/host should advertise

Optional additions to `DatasetDescriptor.capabilities`:

```ts
queryVersions?: (1 | 2)[]; // absent = [1]
runningSumScopes?: ('filteredSelection' | 'beforeDisplayFilter')[];
// absent = ['filteredSelection']
latestSelection?: boolean;
multiSelection?: { fieldId: string; maxValues: number }; // 2..200
```

F1 example **only after implementing and testing the provider**:

```ts
charts: ['table', 'line', 'bar', 'pie', 'scatter'],
queryVersions: [1, 2],
runningSum: true,
runningSumScopes: ['filteredSelection', 'beforeDisplayFilter'],
latestSelection: true,
multiSelection: { fieldId: 'season', maxValues: 20 },
comparisonDimensions: ['season'],
// Keep maxDimensions, maxRows, maxSeries and completeGroupedQueries accurate.
```

- `latestSelection: true` guarantees that **every** `resolveSelection({policy:'latest'})` consistently checks current local revisions rather than reusing the snapshot catalog loaded at process startup. It does not imply network/sync.
- `partitionIds: []` means all eligible local partitions, including new partitions on reopening. A nonempty list restricts scope; no partition may be silently omitted. Season filters are field filters, not partition IDs inferred by the library.
- The resolved selection stays consistent during the session. Queries and facets use its token; they do **not** switch to latest on every call. Reopening a model resolves latest again; this is not real-time refresh. Provenance shows revisions actually used for that opening.
- The multiselection field must be an available dimension with the `in` operator. Implement `facet` with search/pagination, returning typed IDs and source labels. The UI includes a searchable facet, not a comparator limited to two years. `maxValues` limits explicitly checked values; **All** removes the restriction, rather than inventing a sample of up to N seasons. Query/chart limits still apply. Other filters can reduce available facet options.
- Preserve season in group identity and `window.partitionBy`. The same driver/round in different years does not become one observation. The multiselection hint also permits using this field in the `comparison` slot, even if it is not in `comparisonDimensions`, leaving `series` free for another dimension. The core need not know about seasons.

Do not mark `latestSelection` on the current F1 provider if it still caches initial snapshots. The library makes models unavailable without this guarantee **and** a v2 store.

## 3. Pie and scatter

`ChartKind` adds `'pie' | 'scatter'`. `VisualizationSpec` extensions:

```ts
secondaryMetric?: { metricId: string; aggregation: Aggregation };
cumulativeScope?: 'filteredSelection' | 'beforeDisplayFilter';
table?: {
  version: 1;
  columns: string[];
  sort?: { columnId: string; direction: 'asc' | 'desc' };
};
```

Scatter:
- `x` remains the **dimension/grain of the observation**, not a measure. `metric` is the numeric **Y** measure, `secondaryMetric` the numeric **X** measure.
- `QueryRequest.metrics` contains `[metric, secondaryMetric]`. Return both columns in the same grouped row, with distinct output IDs and validated types. Do not run two independent queries or associate measures by row position.
- All dimensions must be allowed by **both** metrics and include their `requiredDimensions`. Each pair may have its own permitted aggregation. The UI offers scatter only when a compatible second measure exists.
- Grouping/comparison identifies series. Each complete row is a point; negative X/Y values are retained. A pair with either measure null is omitted, with an explicit count in the UI/accessible description; the exact row remains in the table.

Pie:
- One slice per **complete** grouping key (including season), without summing years/groups in the renderer. Labels include key dimensions.
- Any negative value rejects the chart (`NEGATIVE_PIE`); it does not use absolute values. Nulls are omitted with a warning. Zeros do not produce visible slices; a zero/null total rejects the chart (`EMPTY_PIE`), without division or a fictitious circle.
- Up to `min(maxSeries, 100)` slices; refine filters or use the table when exceeded.

Both use actual ECharts `PieChart`/`ScatterChart` modules, SVG, richText tooltips, without injected HTML, formulas, executable plugins or document-provided ECharts options. Neither supports running totals. Partial results do not become charts. Number is approximate; magnitudes above the safe limit, Infinity and underflow are rejected. Table/transport/export decimals remain exact. Scatter: up to 20,000 points and `maxSeries` series; line/bar remain limited to 20,000 cells.

## 4. Saved models — exact interface

`AnalysisStore` retains its v1 methods and gains **only** `models?: SavedModelStore`. The host must use a separate namespace/table, without sending v2 to the native v1 store.

```ts
interface SavedModelDocument {
  documentVersion: 2;
  kind: 'model';
  id: string;
  revision: string | null;
  title: string;
  datasetId: string;
  datasetSchemaVersion: string;
  datasetSemanticVersion: string;
  binding: { policy: 'latest'; partitionIds: string[] };
  visualization: VisualizationSpec;
  filters: Filter[];
  createdAt: string;
  updatedAt: string;
}
interface SavedModelStore {
  documentVersion: 2;
  list(signal?: AbortSignal): Promise<AnalysisSummary[]>;
  load(id: string, signal?: AbortSignal): Promise<unknown>;
  save(document: SavedModelDocument, expectedRevision: string | null,
       signal?: AbortSignal): Promise<SavedModelDocument>;
  delete(request: { id: string; expectedRevision: string },
         signal?: AbortSignal): Promise<void>;
}
// AnalysisSummary = { id, revision, title, updatedAt }, all strings.
```

Required rules:
1. `save` creates with `revision === expectedRevision === null` if the ID does not exist; updates/renames only when both revisions match the persisted one. Return the same content/timestamps with a **new non-null revision**. The UI validates the response and rejects a store that modifies content. CAS must be atomic in the host.
2. `delete` also performs atomic CAS. Conflict → `SandboxError('CONFLICT', ...)`; missing → `REVISION_MISSING`. Never silently overwrite/delete.
3. A model has no `selection`, token, snapshot references or rows. Validate with `parseModelDocument(raw, descriptor)` at the transport boundary. Dataset versions must match; do not silently upgrade.
4. `list` returns only real records (maximum 1000 in this UI), without preinstalled examples. `load` must match the requested ID. AbortSignal must be respected; abort does not promise to undo an already committed write.
5. Create: **Save model**; update/rename: edit configuration/title and **Save model**; duplicate: **Save as new model**; delete: select record and confirm **Delete model**. The model being edited is identified separately from the open/delete selector. **Refresh list** does not resolve data again or discard edits. **Open** calls latest again.
6. On error/conflict edits remain in memory; no autosave, merge, draft recovery, model revision history or durable backend is included.

`makeModel(d, partitionIds, visualization, filters, title, previous?)` creates/updates the payload. `makeAnalysis` remains exclusive to pinned v1 analyses. Saving a model from a pinned analysis is an explicit action with a new ID and no change to the old one.

`examples/memory-provider.mjs` offers a **volatile** CAS store and injected fixture reader. Invented data exists only in tests/examples, never in the `Sandbox` component or as fallback when real provider/store are missing.

## 5. Running total contract for Terra (F1)

`QueryRequest.protocolVersion: 2` permits `displayFilters?: Filter[]` and `window.scope: 'beforeDisplayFilter'`. The UI moves **only filters on the `x` axis** (round) from `filters` to `displayFilters` when the user chooses this scope. Other filters remain input population filters.

Required provider order:

```text
validate request, versions, capabilities and selection
→ read occurrences from resolved revisions
→ apply filters (population)
→ aggregate by dimensions (one row per key)
→ calculate runningSum in ASC order of typed window.orderBy value
  restarting by ALL window.partitionBy fields
→ apply displayFilters to grouped dimensions
→ sort for presentation by orderBy
→ check limit / totalRows / complete and return protocolVersion: 2
```

Illustrative example of **actual fields to be implemented by the adapter**:

```ts
dimensions: ['round', 'driver', 'season'],
metrics: [{ metricId: 'points', aggregation: 'sum' }],
filters: [{ fieldId: 'season', op: 'in', values: ['2024', '2025'] }],
displayFilters: [{ fieldId: 'round', op: 'range', min: 5, max: 10 }],
window: {
  kind: 'runningSum', metricId: 'points', orderBy: 'round',
  partitionBy: ['driver', 'season'], scope: 'beforeDisplayFilter',
},
```

At round 5, show the total calculated from the beginning of the input set, **including rounds 1–4**, not a sum starting at round 5. Round 10 includes 1–10, not later rounds. Do not apply LIMIT before the window; descending display order does not reverse accumulation either. Do not confuse values from different years. For F1, aggregate allowed points occurrences by driver/round/season before the window (e.g. race+sprint if both are in the population). Terra must define/test expected coverage, nulls, missing events and source duplicates; absence is not zero and must not be filled in by the library.

Team/session filters remain in the input: they can exclude part of a driver's career or sprint results. This total is **not automatically official standings**, nor a complete season-to-date if imported events are missing. For different population semantics, create an explicit contract rather than silently moving these filters after the window.

V1 remains `scope: 'filteredSelection'`: the round filter applies **before** summing. The same range 5–10 accumulates only 5–10. Describe this difference and keep both behaviors tested; do not reinterpret saved v1 analyses. V2 validates that the axis does not appear in input filters and that the cumulative display filter uses that axis. `partitionBy` is required and complete; order must be an ordered dimension; the metric must be additive, with `supportsRunningSum` and `sum` aggregation. Exact decimal calculation is the provider's job, not ECharts or React's.

## 6. Table and edit protection

- All visualization/axis/metric controls are **on the right**; there is no second configuration at the top. The center keeps title, actions, result and preview.
- Columns use logical query IDs, not translations/DOM positions. Choose by checkbox; reorder using native ↑/↓ buttons (Tab + Enter/Space) or Alt+↑/↓ on the column control. At least one column remains visible. Order/visibility/sort persist in v2.
- Sort by header button or editor on the right. `tableRows` stably sorts **all received rows before** 50-row pagination, with exact decimal comparison and nulls last. It uses original typed values, not translated labels; it does not sort only the page or change chart/calculation order. A partial result is identified; sorting the preview does not make it complete.
- Fields removed from the query are removed from configuration; still-valid columns retain their order. If none survive, the editor uses current columns. CSV continues to export the full result with contract columns, not only visible columns.
- Dirty state compares title/configuration/filters to the last opening/save. A warning and confirmation appear when opening an analysis/model, changing dataset or applying a preset. Deleting a model requires its own confirmation; it does not delete the in-memory configuration.

Optional additions to `SandboxHostServices`:

```ts
confirm?: (request: {
  kind: 'discardChanges' | 'deleteModel'; title: string;
}, signal?: AbortSignal) => Promise<boolean>;
onDirtyChange?: (dirty: boolean) => void;
```

Without `confirm`, the library shows an accessible local confirmation (Cancel/Confirm, Escape, focus and inert outside region). It also registers browser `beforeunload`. **The shell must use `onDirtyChange` to protect external navigation, Tauri closing and deliberate changes to `provider`/`selection` props.** The library cannot stop the host unmounting the component. `false` is notified on unmount. Keep provider/store/host/selection stable across renders.

## 7. Verification and remaining limits

In `packages/`: `npm test`, `npm run build`, `npm run size`. Tests include unchanged v1 golden, v2 calculate-before-filter, real ECharts SVG for both charts, negatives/nulls/zeros, compatible measures, three campaigns, decimal sorting, keyboard columns, CRUD/CAS, local confirmation and latest vs pinned reopening.

Not implemented here: durable backend/model store, IPC/Tauri/SQLite changes, F1 running totals, updating the cached F1 catalog or enabling its capabilities, telemetry, autosave, background data refresh, unlimited large histories, virtualization/streaming or new export formats. No test accesses the personal database. jsdom/SSR do not validate layout, contrast, screen readers, real WebKitGTK/CSP or native backend transactions/concurrency; those are the integration's responsibility.
