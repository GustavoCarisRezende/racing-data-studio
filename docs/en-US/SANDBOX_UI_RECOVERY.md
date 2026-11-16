# Sandbox — functional/visual correction of 12 November 2026

## Current behavior

Unified model management and profiles selected as metrics remain relevant. Layout and control details may have evolved; check the code and later reviews.

Reference: `temp/exemplo_sandbox_dados.png`. This review corrects the library and two essential points in the F1 host without changing SQL, migrations, data or persisted models. Earlier integration changes were preserved. No commit/push.

## Models in one management interface

- Persisted default and user models come from the **same** `modelsV3.list` call (or `models.list` in a v2 host), in the **Saved models** group. There are no fictional fallback records in the component.
- Opening, deleting with confirmation/CAS, renaming through the title and saving a copy are integrated. Save is in the top bar. Old pinned analyses remain separately available within the same group, without automatic conversion.
- Dataset views are in **Dataset views**, inside the manager, identified as initial configurations, not fake persisted records.
- **Manage models → Restore missing defaults** appears only with real host support. After completion, the list refreshes automatically. It does not require pressing another button, change the visualization being edited or clear its draft.

New optional `SandboxHostServices` capability:

```ts
restoreDefaultModels?: (signal?: AbortSignal) => Promise<void>;
```

The host guarantees restoration only of missing IDs, preserving existing models, including user-edited defaults. The client does not recreate defaults on mount, open, list refresh or delete. Errors remain visible; success is not simulated.

## Causes of unnecessary warnings and data protection

The view selector previously retained both the earlier baseline **and** the link to the open model. Thus a newly selected view already appeared edited and could direct the next save to the previous record. Now each explicitly opened view starts clean and unlinked, without writing/deleting the previous record.

Dirty state previously compared `JSON.stringify` directly. `editableKey` compares canonical content: property order, AND filter order and OR value order/repetition do not produce edits. IDs are compared by wire value, not local collation. Column order, titles, scopes and `extraDimensions: []` remain real differences when they change configuration/protocol; no normalization erases versioned semantics. Saving a trimmed title synchronizes the baseline and input.

Opening another unchanged model, changing language, refreshing the list, expanding controls or merely focusing the title to rename does not ask to discard/save. A real change still requires confirmation when opening another configuration; Cancel preserves the edit. If the user returns exactly to the original configuration, it becomes clean again. Conflicts remain explicit, without automatic overwrite.

## Charts at the top and pie diagnosis

- Line, Bar, Table, Pie and Scatter have buttons with icons, names and `aria-pressed`, only for real capabilities. The type selector on the right was removed. There is no fictitious export when the host supplies no exporter.
- PieChart was already registered in ECharts. The common problem was switching from Line while retaining round × driver × season: hundreds of slices were rejected and the error appeared only as “incompatible configuration.”
- When **explicitly pressing Pie**, `forPie` chooses a compatible nominal category (prioritizing the current grouping), preserves required comparisons/groupings and filters, and turns off running totals/secondary measure. The grouping is displayed on the right and the change is reported. It does not sum already calculated running totals in the renderer.
- Opening an existing document **does not** call this transformation. Older models retain their grain, filters and semantics, including native defaults by team.
- If a selection still exceeds `maxSeries`/100 slices (for example many seasons), the UI explicitly asks for fewer seasons/categories; it does not hide years or sample data. Negative values/a total with no positive value remain rejected with a specific warning. The table retains exact values. This was not “fixed” using absolute values.
- Returning to Line from a category chooses a compatible ordered axis, using the descriptor's real default where possible. Only an explicit action changes the grain.

## “Points after the event,” without a profile abstraction in the UI

The v3 contract remains exactly the same. The user selects a **metric**; the technical “Calculation profile” selector no longer exists on screen.

`RunningSumProfile` accepts optional presentation metadata:

```ts
measureLabel?: LocalizedText;
// F1: { fallback: 'Points after the event',
//       translations: { 'pt-BR': 'Pontos após o evento' } }
```

The option uses the provider-advertised profile and produces the same existing v3 `calculation`, `metricId`, partitions, chronology and post-calculation filters. It does not create a fictional persisted metric, change the algorithm or promote v1/v2 documents. An intuitive label appears in the selector, chart, table and column editor. Without the metadata, it falls back to the actual profile label. Saved legacy running totals keep their semantics; they are not presented as the new calculation.

## F1 host: files changed in this round

- `app/src/categories/f1/analysis-screen.tsx`: injects `restoreDefaultModels` calling the **already existing** `f1_models_restore_defaults` command; removes the external button and global warning duplicating management. An incompatible filter restriction is reported contextually and generically by the library, using the error's `fieldId`.
- `app/src/categories/f1/analysis-provider.ts`: only the localized `measureLabel` for `driver-all-sessions-v1`. Calculation, query, revision and source were not changed.

No `app/src-tauri/` file was modified in this round. There is no migration, reset, model cleanup or silent update of existing records.

## Layout, accessibility and validation

- 20/60/20 in containers ≥1100 px; two columns at ≥750 px, with configuration below the result; stacked below that. This avoids three unreadable columns at 1024 px.
- Decorative icons, accessible names, native keyboard controls, visible focus, `aria-busy` status, confirmation with Cancel/Escape and sortable headers with `aria-sort`. New controls/warnings have PT-BR/en-US; user-saved names are not translated/rewritten as application text.
- `packages/npm test`: **39 tests**. `app/npm test`: **19 tests**. Builds of both workspaces passed. The web build retains a lazy chunk >500 kB warning; performance with large histories on desktop was not validated.
- Regression uses the real F1 adapter with a synthetic reader and **real EChartsRenderer**: open unchanged v2/v3 models without confirmation, object/filter normalization, language, presets, SVG pie, real edit/Cancel, rename/save and restoring a missing default without overwriting edited defaults or discarding a draft.
- Separate preview with **invented** calendars/people/teams/models, in memory only. `?model=teams` opens the pie through real controls; `?model=cumulative` opens bars with the intuitive metric. `?selected` exercises filters/comparison. `examples/synthetic-models.mjs` is not used as a library/app fallback.
- Headless Firefox captures in isolated temporary profiles, waiting for SVG/table: `/tmp/opencode/sandbox-ui-20261112-pie.png`, `-cumulative.png` and `-mobile.png`. The loopback server was stopped and the port verified free on completion.

Screenshots/jsdom do not replace Tauri/WebKitGTK, screen readers, real IPC, SQLite concurrency or inspection of personal historical data. None of those sources was accessed here. Shell closing/external navigation must still respect `onDirtyChange`; this library protects its internal transitions, not forced unmounting by the host. No persistent server was added.
