# Independent Sandbox — v0.1.0

Racing Data Studio's own library, without imports from the application, F1, Tauri, SQLite, or data sources. The F1 host in `app/` integrates it; packages do not access the database/importer. Tests use fixtures only. Code and fixture license: [Apache-2.0](../../../LICENSE).

## Packages

| Package | Responsibility |
|---|---|
| `@rds/sandbox-contracts` | v1 metadata/selection, v1/v2/v3 queries, v1 pinned analyses, v2/v3 latest models, and runtime validation |
| `@rds/sandbox-core` | Defaults, configuration, queries, chart model, exact values, and CSV + manifest |
| `@rds/sandbox-react` | Responsive editor, filters, table, save/open through an injected store, and i18n |
| `@rds/sandbox-echarts` | Modular ECharts 6.1.0 SVG adapter; lines, bars, pie, and scatter |

Packages are private ESM packages with `dist/` exports; they are not published to npm. `sandbox-react` does not depend on the ECharts adapter. React is a peer dependency: the application must resolve **a single instance** of React/React DOM. The workspace has its own lockfile, without changing `app/package.json` or its lockfile.

## Install and verify

Run these commands **inside `packages/`**, never at the repository root or inside `app/`:

```sh
npm ci --ignore-scripts --registry=https://registry.npmjs.org
npm run build
NODE_OPTIONS=--max-old-space-size=1536 node --test --test-concurrency=1 tests/*.test.mjs
npm run size
npm audit
npm audit signatures
npm run notices
```

Use the [resource-bounded test commands](../DEVELOPMENT.md#tests-and-resource-limits) for cgroup memory/swap and time limits as well. The serial command above replaces the default-concurrency `npm test` invocation.

Node supported by the test workspace: `^22.22.2 || ^24.15.0 || >=26.0.0` (the higher requirement comes from development-only jsdom). Validated with Node 24.18.0. Running TypeScript directly in Node is unnecessary: `tsc -b` emits ESM JavaScript, and the native runner executes `tests/*.test.mjs`. There is no server, browser download, authorized installation script, or dependency on the application's Node runtime. Incremental build output and `node_modules` are ignored by Git.

The esbuild used only for measurement uses the platform's optional dependency binary. If that package is missing for the platform, **do not enable all installation scripts**: review the official distribution and explicitly install the compatible binary. This tool is not part of runtime.

## Composition

```tsx
import { Sandbox } from '@rds/sandbox-react';
import { EChartsRenderer } from '@rds/sandbox-echarts';
import '@rds/sandbox-react/style.css';

// Stable instances (useMemo or module-level), implemented by the host.
<Sandbox
  provider={provider}
  store={analysisStore}           // v1; optional .models enables the v2 model store
  host={hostServices}             // optional: no exportFiles means no export
  ChartRenderer={EChartsRenderer} // optional: without a renderer, only tables
  locale="en-US"
  selection={selectionRequest}    // optional: defaults to latest, provider-local scope
/>
```

For an executable example without I/O, use `examples/memory-provider.mjs` with `fixtures/orchard.dataset.json` and `fixtures/orchard.rows.json`, under the root `packages/` directory. This is a **fixture-specific** adapter, not a generic production engine. Its store is volatile: persistence across restarts belongs to the real store.

Full integration guide: [SANDBOX_INTEGRATION.md](../SANDBOX_INTEGRATION.md).
**New interfaces and exact handoff to Terra:** [SANDBOX_V2_HANDOFF.md](../SANDBOX_V2_HANDOFF.md).
**Cross-session accumulation with multiple slicing fields, extra grain, and opt-in v3:**
[SANDBOX_V3_ACCUMULATION.md](../SANDBOX_V3_ACCUMULATION.md).
**Current UI, unified management, pie charts, and correction of inappropriate warnings:**
[SANDBOX_UI_RECOVERY.md](../SANDBOX_UI_RECOVERY.md).
Dependency and CSP review: [SECURITY.md](SECURITY.md).

V2/v3 models accept `saveFilters` and `saveDataSelection`, optional booleans the store must preserve. Absence means `true` for older documents. The primary selection field is `multiSelection.fieldId` or, if absent, `presentation.primaryFilterFieldId`: its filter is saved/restored according to `saveDataSelection`; other filters follow `saveFilters`. With `saveDataSelection: false`, `binding.partitionIds` is saved empty and the current selection is retained when opening a model for the same dataset.

## Implemented features

- Provider catalog and metadata; dimensions and metrics are not inferred from names.
- Typed grouped queries, checked versions, and IDs separate from labels.
- AND filters with OR multivalues, inclusive ranges, literal text, and nulls.
- Optional facets with search, pagination, and counts; no facet means no `in` editor.
- In-memory paginated table, 50 rows per page; complete results separate from presentation. Export includes every row, never just the page.
- Actual line, bar, pie, and scatter charts, only when allowed by data and when a renderer exists. Scatter uses two distinct compatible metrics, omits null pairs with a warning, and preserves negatives. Pie rejects negatives/totals without a positive value.
- Comparison as an extra dimension; series include all grouped identities.
- Legacy accumulation **of the filtered set**, plus optional v2 scope that calculates before slicing the axis. Both are calculated by the provider, partitioned by all series/comparisons. Neither promises official standings or complete history.
- Opt-in v3 calculation profiles separate grain, partition, and multiple slicing fields (e.g., round and session). Chronology/availability belong to the provider; the core infers neither order nor zero, and unknown chronology requires an error.
- Analyses pinned to revisions; restoration resolves `pinned` and checks revisions and transformation version. No silent update to more recent data.
- Store-based save/open with optimistic revisions and rejection of future documents.
- V2 latest models with create/open/update/rename/duplicate/delete through an injected store and CAS; enabled only with `store.models.documentVersion === 2` and `capabilities.latestSelection === true`. They contain neither snapshots nor data rows.
- Explicit **v3** models and `AnalysisStore.modelsV3` for extra profiles/dimensions; this store reads v2/v3 without reinterpreting versions. Without it, new fields are not saved to the old store. V1/v2 queries, documents, and constants remain compatible.
- Generic searchable multiselection through `capabilities.multiSelection`, preserving selected year/dimension in group identity. Not limited to two seasons.
- Keyboard-selectable/reorderable columns and exact decimal sorting before pagination. `table.version: 1` configuration persists in v2/v3 models, never v1.
- The UI exports tables as a single UTF-8 CSV; charts can be exported as SVG or PNG through the injected service. Core manifest-generating functions remain available to existing consumers.
- PT-BR and en-US; translatable metadata, exact decimal formatting, dates without time-zone shifts, and native keyboard controls. Switching language does not clear the analysis.
- Three 20/60/20 panels in containers ≥1100px; two at ≥750px; stacked below that. The host widens the Sandbox canvas without changing other screens.
- Primary selection and actual presets through `presentation`, direct dimension filters, configuration only on the right, and collapsible preview.
- Five chart-type buttons at the top without a duplicate type selector. Persisted default/user models share one manager; missing defaults are restored only through an explicit action/host capability, with an updated list.
- Calculated measures use `RunningSumProfile.measureLabel` in the same metric selector without exposing a technical profile editor or reinterpreting old documents.
- Unsaved-change warning and modal confirmation when replacing edits/deleting models; `host.onDirtyChange` remains available to the shell.
- Entity names through `labelField`; codes translated through `valueLabels`; identities remain stable in filters and queries.
- AbortSignals, stale-response disposal, query/facet debounce, cell limits, and renderer/ResizeObserver cleanup on unmount.

## Limits of this version

- The UI uses one metric, or two for scatter, and up to three dimensions: X/grain, series, comparison. Query v3 allows extra dimensions for grain with four or more dimensions (up to the provider limit, maximum 10). Multiselection does not aggregate years.
- No raw occurrence/calendar query without a metric: the editor requires at least one compatible metric and dimension. Record-only tabular datasets need a versioned extension, not a fabricated count.
- Accumulations and `latest` resolution depend on the provider. The current F1 adapter implements them; `latest` resolves each season's active snapshot, not necessarily the most recently saved one.
- No formulas, SQL, executable plugins, moving averages, dashboards, file import, PDF/XLSX, or autosave.
- V1/v2 queries have no result cursor. The provider must return a complete aggregate within limits or throw `LIMIT_EXCEEDED`. An incomplete result can be inspected as a table but cannot become a chart, saved analysis, or export.
- Declared maximum: 100,000 rows; a global budget of 500,000 validated cells; line/bar limited to 20,000 cells, scatter to 20,000 points, pie to 100 slices; all also respect the dataset's `maxSeries`. These ceilings do not promise responsiveness on any hardware.
- Facets: up to 100 values per requested page, 1,000 displayed, 200 selected. Store list: up to 1,000 entries in this UI; paginated listing requires another protocol.
- The whole query page stays in memory; virtualization, Arrow, streaming, Workers, and query caching are not implemented.
- Decimals are exact in tables/exports and transport; charts use approximate Number values, rejecting unsafe magnitudes and underflow. Calculations belong to the provider.
- A missing cell is not zero; the renderer does not connect gaps. The provider must model expected absences: the UI invents neither calendars nor historical knowledge.
- In-memory editor: confirms destructive internal switches and registers `beforeunload`; external navigation/native close depend on `host.onDirtyChange`. No draft recovery. Durable persistence belongs to the host; the example store is volatile.
- Schema/semantic changes are not automatically migrated: v1 rejects incompatible versions. No reproducibility promise for transformations the provider no longer maintains.

## Verification and outstanding checks

Tests include positive/negative contracts, Rust-neutral JSON fixtures, decimals, nulls, cross-campaign comparison, accumulations, store/conflicts, CSV, stale responses, unmounting, i18n, React lifecycle with jsdom, and real ECharts SVG rendering in SSR. The load test validates/models/exports 5,000 rows; it does not measure WebView rendering.

`npm run size` produces in-memory bundles without installing a server or writing a release; it measures minified JavaScript and gzip with React external. It checks for `eval/new Function` and contributions from unrequested charts in the sample. This is a limited check, not a formal security audit or final installer measurement.

**Still needed in integration:** a production Tauri build with real CSP; visual validation at breakpoints; keyboard/screen-reader testing (including Orca); 200% zoom; high contrast; performance/RAM in WebKitGTK and other platforms; additional persistent-backend checks; native cancellation; and legal review of real-data licenses. jsdom does not check layout, contrast, or CSP enforcement.
