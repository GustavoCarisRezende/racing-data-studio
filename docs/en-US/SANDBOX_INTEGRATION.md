# Sandbox integration contract — protocol/document v1

## Current behavior

The v1 contract remains relevant for pinned analyses, but does not describe all extensions. The F1 host also uses v2/v3, `latest` resolves the active snapshot and current export does not produce a manifest.

> Current extensions (v2 queries, latest models, pie/scatter, table and handoff to Terra): [SANDBOX_V2_HANDOFF.md](SANDBOX_V2_HANDOFF.md). This document retains the legacy contract; pinned v1 analyses are not converted into models.

> Cross-session accumulation with multiple post-calculation filters: opt-in contract [SANDBOX_V3_ACCUMULATION.md](SANDBOX_V3_ACCUMULATION.md). It does not change v2 semantics.

Independent library in [`packages/`](../../packages/README.md), integrated by the `app/src/categories/f1/analysis-*` layer. The visual review of 8 November 2026 also adjusted React composition and the F1 adapter, without modifying SQLite, migrations, synchronization or permissions. Visual tests use invented snapshots, not the user's database. See [SANDBOX_UI.md](SANDBOX_UI.md) for panel organization, optional presentation metadata and visual test reproduction.

## 1. Responsibilities and entry points

```text
Application/category → provider/store/host adapter → Sandbox React
                                    ↓                    ↓
                             category backend       own ChartModel
                                                         ↓
                                                   ECharts adapter
```

- Contracts: `packages/sandbox-contracts/src/index.ts`.
- Runtime validation: `packages/sandbox-contracts/src/validation.ts`.
- Core: `packages/sandbox-core/src/index.ts`.
- UI: `packages/sandbox-react/src/index.tsx`; CSS must be explicitly imported.
- Renderer: `packages/sandbox-echarts/src/index.tsx`.
- Reference provider/store: `packages/examples/memory-provider.mjs`.
- Neutral fixtures: `packages/fixtures/*.json`.

No package knows native command names, database paths, tables, sporting entities or the Jolpica JSON structure. Do not copy that knowledge into the shared core.

## 2. Preparing packages for consumption

1. In `packages/`, run `npm ci --ignore-scripts` and `npm test`.
2. Exports point to `dist/`; compile before building the application.
3. Register **all local packages used** in the workspace/local dependency mechanism chosen by the integration. Do not publish or try to obtain `@rds/*` from the public registry; they are private local packages at version 0.1.0.
4. Installing a single local package alone does not automatically resolve the other private packages. The integrator must review transitive resolution and the application lockfile when making that change. A controlled Vite alternative is to resolve the four `@rds/*` names to their respective `packages/sandbox-*/dist/index.js` and resolve `@rds/sandbox-react/style.css` to `packages/sandbox-react/src/style.css`. In that case, `npm ci` in `packages/` remains a build prerequisite, ECharts is resolved in the packages workspace and the application must use `resolve.dedupe: ['react', 'react-dom']`. Also review dev server file access scope; do not expose the entire filesystem. This alternative requires validation in the real host build, not yet performed here.
5. If using links/aliases from another workspace, deduplicate `react`, `react-dom` and `react/jsx-runtime` to the application's copy. Peers accept React 19; do not load the development React from `packages/` as a second instance in the host bundle.
6. Do not include jsdom, TypeScript or esbuild in desktop runtime.

Composition example (the integrator decides how to resolve local imports):

```tsx
import { Sandbox } from '@rds/sandbox-react';
import { EChartsRenderer } from '@rds/sandbox-echarts';
import type { SelectionRequest } from '@rds/sandbox-contracts';
import '@rds/sandbox-react/style.css';

// Create outside render or with useMemo. Do not recreate provider/store/selection on each render.
const selection: Omit<SelectionRequest, 'protocolVersion' | 'datasetId'> = {
  policy: 'latest', partitionIds: ['2024', '2025'],
};

function AnalysisScreen() {
  return <Sandbox provider={provider} store={store} host={host}
    selection={selection}
    ChartRenderer={EChartsRenderer} locale="pt-BR" />;
}
```

Recommendation: lazy-load the screen and renderer on sandbox entry. The library does not create a server; the renderer receives already calculated data. Without a renderer, the UI only offers a table. Without store/exportFiles, the respective controls do not appear.

## 3. Provider and data description

Interface implemented by the category adapter:

```ts
interface SandboxDataProvider {
  listDatasets(signal?: AbortSignal): Promise<DatasetSummary[]>;
  describeDataset(request: { datasetId: string; locale: string }, signal?: AbortSignal): Promise<DatasetDescriptor>;
  resolveSelection(request: SelectionRequest, signal?: AbortSignal): Promise<ResolvedSelection>;
  query(request: QueryRequest, signal?: AbortSignal): Promise<QueryResult>;
  facet?(request: FacetRequest, signal?: AbortSignal): Promise<FacetPage>;
}
```

`listDatasets` returns only usable local data; do not list mocks or remote sources as available. The catalog is limited to 200 datasets in this UI. IDs and versions are stable and never translated. Labels use `{ fallback, translations? }`.

`describeDataset` must provide necessary translations in the same descriptor. Changing language in the UI reformats the existing result without querying again or losing filters. `locale` is an initial suggestion to the adapter, not a dataset identity key.

Each field declares physical type, dimension/measure role, analytical type, nullability, order, operators and availability. **A numeric field does not imply a summable measure.**

| Physical type | JSON value |
|---|---|
| `integer` | safe integer, without NaN/Infinity |
| `decimal` | canonical decimal string, e.g. `"12.50"`; no exponents/commas |
| `date` | `YYYY-MM-DD`, without timezone conversion |
| `datetime` | ISO instant with seconds, explicit timezone and up to three millisecond digits |
| `string` / `boolean` | corresponding value |
| null | `null`, never an empty string or zero to represent absence |

Large numeric IDs, such as SQLite IDs, must be strings, not unsafe `integer`s. Do not use `__proto__`, `constructor` or `prototype` as an ID. Technical IDs follow `[A-Za-z0-9][A-Za-z0-9_.:-]*`, up to 128 characters.

Metrics have an output ID **different** from the raw field ID. Example: `harvest_kg` is a field; `harvest` is a metric. This avoids ambiguity between raw and aggregated data. Metadata includes definition, permitted aggregations, groupings, null policy, additivity and running-total support.

`requiredDimensions`, when used on a metric, prevents removal of mandatory semantic dimensions. For example, a category may require the season dimension to avoid silently summing seasons. The editor preserves that grouping and the backend must also check it. This is not a built-in F1 rule.

Do not mix aggregations with different units in one metric (for example kilograms and measurement counts): publish separate metrics with correct definitions and units. `groupableBy` is an allowlist, not a suggestion.

`labelField` is optional: the grouped ID remains in the original column, and the provider can return an auxiliary text column with the label. It must be described in the fields. Charts retain ID alongside label to avoid collisions between names.

Capabilities represent real functionality. `comparisonDimensions` identifies dimensions that can be added to series identity; the library does not infer historical equivalence between them.

## 4. Revisions and consistency

`resolveSelection` receives `latest` or `pinned`, opaque partitions and, in the second case, complete references. It returns:

```ts
{
  protocolVersion: 1,
  datasetId: 'dataset.id',
  token: 'opaque-token',
  transformationVersion: 'provider-transform-1',
  revisions: [{
    partitionId: '2024', revisionId: '123',
    sourceDataAt: '2026-01-01T00:00:00Z',
    storedAt: '2026-01-02T00:00:00Z',
  }],
}
```

Requirements:

- Resolve all partitions in a consistent read; maximum 2000 references.
- The token must identify **exactly** the resolved data and transformation.
- Subsequent queries/facets never switch to latest on their own.
- An expired token may be reconstructed for the same revisions; it must not permit arbitrary selection or bypass validation. Do not serialize a connection/path in the token.
- A missing revision or compatible transformation produces `REVISION_MISSING`/an explicit error, never silent fallback.
- `storedAt` and `sourceDataAt` have different meanings; copying/restoring does not make content newer. `sourceDataAt` may be null if unknown.

On reopening, the UI calls `resolveSelection(pinned)` and checks references and transformation version. The token may change, but the data does not. No new data is downloaded. An initial `latest` selection is also frozen after resolution. To deliberately refresh the screen, the host can change `selection` identity or remount the sandbox; this action is not automatic and no fictitious button is implemented.

## 5. Query v1: executable semantics

See fixtures `query.request.json` / `query.result.json`. Both are compared with the reference provider in tests; the Rust backend can consume the same files.

Required order:

```text
validate versions/capabilities/selection
→ select occurrences in revisions
→ population filters (AND; OR within in)
→ aggregate by all dimensions
→ apply window if requested
→ sort according to orderBy
→ check limit and return complete result
```

- `dimensions` contains unique IDs of available dimension fields.
- `metrics` contains permitted metricId and aggregation pairs.
- Each dimension must belong to each metric's `groupableBy`.
- Return exactly one row per grouping key. Repeated source occurrence IDs must be retained **before** aggregation, not deduplicated by the UI or an assumption of sporting uniqueness.
- `orderBy` uses typed values; integers cannot be sorted as strings.
- Decimals must be calculated without intermediate rounding in `f64/Number`.
- `contains` filter strings are literal, not SQL LIKE or regex without escaping. Document the provider's case/accent policy; the example is case-insensitive.
- There is one filter per field; replacing an existing filter is explicit in the editor.
- Ranges are inclusive. Canonical dates are comparable; instants must be compared chronologically, not lexically across different timezones.
- `isNull/isNotNull` do not mean zero/nonzero.

V1 windows allow only `runningSum` with `sum` aggregation, an additive measure and an ordered axis. `partitionBy` must contain **all** remaining dimensions. `scope` is always `filteredSelection`: do NOT claim that the total includes rows excluded by filters or official rules external to the dataset.

Absences and gaps belong to the provider's domain. `nullPolicy=ignore` must return null when there is no valid observation; do not fabricate zero. `propagate` causes participating absence to make the aggregate unknown. The provider decides, documents and tests which occurrences were expected. For a running total unknown after a missing event, it must return appropriate nulls in subsequent events; the UI does not reconstruct it.

### Result

- `protocolVersion`, `requestId` and `selectionToken` match the query.
- Columns may be requested dimensions, their labelFields and requested metrics.
- Each row contains all columns, without extra properties; `row.id` is stable within the same result/revision and independent of language.
- Metric types: count/countDistinct → integer; mean → decimal; sum/min/max → source field numeric type.
- `complete=true` means the entire filtered/grouped result, not the first page. If `totalRows` is not null, it must match the returned count.
- No result cursor in v1: exceeding `limit` must produce `LIMIT_EXCEEDED`. `complete=false` is explicitly partial and only enables table inspection.
- Runtime limits: 100,000 maximum declared rows; 500,000 cells checked; 20,000 cells for charts; up to 100 series or a lower dataset limit.
- The React table shows local pages of 50 rows. Do NOT aggregate/export only that page; export uses the complete result.
- Emit structured warnings and translatable limitations, without claiming absolute historical completeness when only imported coverage is known.

## 6. Facets

Implement `facet` only if genuinely supported. The request includes pinned selection, fieldId, filters **without the field's own filter**, literal search, cursor and limit. Returned values retain their physical type; labels and counts are auxiliary. Search/pagination must be stable within the selection; `nextCursor` must progress.

The UI requests 100 per page, limits display to 1000 and selection to 200. Superseded queries receive abort; the UI also ignores late responses. Effective native cancellation, caching and work outside the UI thread are the adapter's responsibility.

## 7. Injected store and saved documents

```ts
interface AnalysisStore {
  list(signal?: AbortSignal): Promise<AnalysisSummary[]>;
  load(id: string, signal?: AbortSignal): Promise<unknown>;
  save(document: AnalysisDocument, expectedRevision: string | null,
       signal?: AbortSignal): Promise<AnalysisDocument>;
}
```

A v1 document contains identity, revision, title, dataset versions, resolved selection, its own visualization configuration, filters and dates. It does not contain ECharts options, functions, HTML or SQL. Use `parseAnalysisDocument` in the adapter and repeat validation in Rust. The `load` return is intentionally unknown.

`save` must be transactional and apply compare-and-swap:

1. New document: `revision=null` and `expectedRevision=null`.
2. If it already exists with a different revision, return `CONFLICT`; never overwrite.
3. Create a new opaque revision, preserving history according to category policy.
4. Return the saved document with non-null revision. Do not change title, filters, selection or visualization during save.

The UI validates the return and marks it saved only if the user is still in the same editing state. `list` allows up to 1000 entries; pagination is a future evolution. The in-memory example does not persist across processes and does not prove native store durability. Real data should be saved in the category database, not a central SQLite database created by the library.

Versions are independent: protocol, document, schema, semantics, transformation and data revisions. Documents are limited to 256000 UTF-16 units after serialization; the backend may impose an additional byte limit, without truncation. Do not silently migrate incompatible documents. The implementation at the time accepted v1 and rejected future versions; migrators must be explicitly added and preserve the original document.

## 8. Export by the host

```ts
interface SandboxHostServices {
  exportFiles?: (files: ExportArtifact[], signal?: AbortSignal) => Promise<void>;
}
// ExportArtifact: { name, mediaType, text }
```

In this legacy contract, the host receives CSV and manifest together; it chooses a destination, asks for confirmation and writes them. Generated names use validated technical IDs, not paths received from the source. Do not grant the UI generic filesystem access. The host must handle overwrite, partial failure, atomicity and cancellation; Promise success means it fulfilled its contract.

CSV uses canonical values, with basic formula protection in text cells. Nulls and empty strings cannot be distinguished; the manifest records this limitation. The manifest includes selection, query, metrics, unit, licenses, attribution and warnings. Do not remove real data attribution. There is no PNG/SVG/PDF/XLSX button in this legacy contract. See the current behavior note above for current export differences.

## 9. Suggested mapping for Terra (not implemented here)

| Method | Suggested category command |
|---|---|
| listDatasets | `f1_analysis_catalog` |
| describeDataset | `f1_analysis_describe` |
| resolveSelection | `f1_analysis_resolve` |
| query | `f1_analysis_query` |
| facet | `f1_analysis_facet` |
| store.list/load/save | `f1_saved_analyses_list` / `f1_saved_analysis_load` / `f1_saved_analysis_save` |

This mapping belongs to the category adapter, not the packages. Prefer a typed projection of existing snapshots, consistent reads and Rust aggregation. Do not reuse raw `f1_season_details` fragments as a generic contract. Cache can use revisions + transformation version. Do not change import or restoration as a side effect of a query.

For the first F1 integration:

- Define grain that preserves multiple historical occurrences.
- Preserve source points, special position, status and team in the result.
- Require the season dimension when necessary (`requiredDimensions`) and always partition running totals by season/series.
- Race/Sprint/Race+Sprint are scopes without double counting; a calendar session does not imply results availability.
- Do not call a sum of result points official championship standings. Discards, penalties and historical constructor rules require their own semantics.
- Do not connect teams by assumed continuity or normalize eras without data.
- Round aligns calendars; it does not identify the same circuit in different years.
- Source, Jolpica license and source date must accompany data and export.

## 10. Integration acceptance

1. Use neutral JSON fixtures for TS/Rust equivalence, including rejections.
2. Build the application with a single React instance and reviewed lockfiles.
3. Test empty catalog, partial data, errors, two seasons, filters and nulls.
4. Confirm complete query/CSV, without a sample disguised as complete.
5. Save, restart offline, open the same revision and detect an edit conflict.
6. Update/restore a season and confirm pinned analyses do not change.
7. Validate capabilities/CSP and network in compiled Tauri; no broad exceptions.
8. Test keyboard/screen reader, 360px, 1024px window, three panels and 200% zoom.
9. Measure query, IPC, RAM and rendering on WebKitGTK and validate additional platforms.
10. Include product licenses/NOTICE and SBOM; do not distribute populated databases.

Outstanding issues and explicit limits are in `packages/README.md`. No test in this workspace accesses personal data or replaces category desktop/backend tests.
