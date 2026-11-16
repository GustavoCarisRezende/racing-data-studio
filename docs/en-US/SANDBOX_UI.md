# Sandbox: visual and functional review — 8 November 2026

> **Historical context:** This document records a review from its time; statements about status, outstanding work and tests are not necessarily current. See [development](DEVELOPMENT.md) and the [user guide](USER_GUIDE.md) for current behavior and implementation differences. The historical text is retained below.

> UI of 12 November 2026: [SANDBOX_UI_RECOVERY.md](SANDBOX_UI_RECOVERY.md). This file retains the earlier visual record, including its breakpoints.

> Original visual review record. The 10 November library extension removes duplicate central controls and adds optional v2 features: see [SANDBOX_V2_HANDOFF.md](SANDBOX_V2_HANDOFF.md). Provider/store-dependent features are not automatically enabled in the F1 host.

Reference: `temp/exemplo_sandbox_dados.png`. The review reproduces the studio hierarchy, not illustrative controls without implementations.

## Organization and selection

- Three panels at 20/60/20 in containers ≥900px; two between 750 and 899px; stacked below that. The host expands only the sandbox area. No horizontal page scrolling is needed; tables may scroll independently.
- Left: primary selection (season in F1), dataset views and searchable filters with checkboxes and a summary. The generic editor is in **Advanced filters**, not the required path for selecting drivers.
- Center: Line/Bar/Table, actions actually supplied by the host, axis/metric/grouping, chart and collapsible/paginated preview.
- Right: fields, aggregation, comparison and metric/capability information. Repeated selectors edit the **same state**, without competing defaults.
- F1 starts with the latest season with local results, Round axis, Driver grouping and a line chart. It does not select fictional favorites.
- Comparing seasons includes a second season in the filter, preserving season/entity identity for each series. It does not import or update snapshots.
- Clearing filters preserves the primary selection and active view scope. Removing an individual filter removes only that field's restriction.
- Facets show source names, not IDs when names are available. Filters still use IDs. Missing names retain a fallback; equal names with different identities are disambiguated. Historical continuity is not inferred.
- Race, sprint and team are presets of the same dataset with real queries. Sprint appears only if sprint results exist in some local slice; a season without sprint can return empty, which is reported without fabricating points.
- A single aggregation appears as informational text, not an unexplained disabled dropdown. Running totals, moving averages, pie, scatter, analytical calendar and native F1 export were not enabled; no controls promise them.

## Optional metadata

These are additions to the v1 descriptor, not the saved document. `assertDataset` validates references, types, limits and configurations. Category-agnostic example:

```ts
presentation: {
  primaryFilterFieldId: 'campaign',
  filters: [{ fieldId: 'plot', label: { fallback: 'Plots' } }],
  defaultVisualization: {
    kind: 'line', x: 'week', metric: { metricId: 'harvest', aggregation: 'sum' },
    series: 'plot', comparison: 'campaign', runningSum: false,
  },
  defaultFilters: [{ fieldId: 'campaign', op: 'in', values: ['2025'] }],
  views: [{
    id: 'harvest-by-plot', label: { fallback: 'Harvest by plot' }, filters: [],
    visualization: {
      kind: 'line', x: 'week', metric: { metricId: 'harvest', aggregation: 'sum' },
      series: 'plot', comparison: 'campaign', runningSum: false,
    },
  }],
}
```

Defaults apply to a new visualization. Opening a saved analysis uses the document without replacing filters/visualization with defaults. Without hints, the UI derives quick filters from dimensions supporting `in`. Without `facet`, it does not offer those controls. Presets do not change datasetId or add properties to JSON sent to the store.

For fixed codes, `FieldDescriptor.valueLabels` translates the label, not the value:

```ts
valueLabels: [{ value: 'results', label: {
  fallback: 'Race', translations: { 'pt-BR': 'Corrida' },
} }]
```

For entities, `labelField` identifies the name column. The provider returns that column when the key is grouped. The table shows the name in the entity cell, without a redundant second column. Facet search should consider name and ID, but `FacetPage.value` must retain the original key. Generic export preserves the complete contract columns and values.

## Visual verification without a database

```sh
cd packages
npm test
node scripts/visual-smoke.mjs
```

The preview opens only `http://127.0.0.1:4179` with a synthetic bundle in `examples/dist/`, ignored by Git. It closes automatically after ten minutes; stop it with Ctrl+C when finished. It does not import Tauri or access SQLite/Jolpica.

`examples/visual-smoke.tsx` uses the **real F1 adapter** with an injected reader and invented people, teams and results from `examples/synthetic-f1.mjs`. The store is volatile. The page identifies the data as synthetic and is not part of the app build.

Preview CSP: local scripts/styles/images, without `unsafe-eval`/`unsafe-inline`. An invisible image waits for real SVG/table output for headless captures, without an arbitrary delay. This mechanism exists only in the visual harness.

`http://127.0.0.1:4179/?selected` exercises controls in the DOM itself: it opens Drivers, selects Ana Lima and Bruno Reis and activates the 2025/2024 comparison before releasing the capture. It does not change app defaults or read selections from a real database.

Automated tests cover season, names, drivers/teams/rounds/sessions, presets, comparison, field synchronization, line/bar, preview and save/open. They also check that Race + Sprint is aggregated once per round/entity, not treated as two unidentified points rows per event.

## Actual limits

- Only already imported results; no official standings, new importers, telemetry, lap times or historical scoring normalization.
- F1 aggregation remains in memory in the TypeScript adapter, with existing limits. Performance with large histories still requires desktop measurement/optimization.
- The UI can edit configurations in memory; there is no autosave or confirmation when changing datasets. The real store remains responsible for durability and conflicts.
- The primary comparison offers two selections; old/advanced documents with more values retain the filters and report additional values.
- Selections remain pinned to revisions. Data updates require host action.
- A browser with synthetic data does not validate Tauri/WebKitGTK IPC, permissions or CSP, and does not replace screen-reader and additional-platform testing.
- No test in this review opens the personal database or performs synchronization.
- To preserve old analyses, advanced F1 text filters still query literal IDs/codes; the form explains this. Name searches should use the searchable Drivers/Teams selections, which return IDs correctly.
