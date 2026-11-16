# Sandbox final review — 14 November 2026

> **Historical context:** This document records a review from its time; statements about status, outstanding work and tests are not necessarily current. See [development](DEVELOPMENT.md) and the [user guide](USER_GUIDE.md) for current behavior and implementation differences. **Current:** legacy analyses can also be deleted in management, with confirmation and optimistic revision checks.

## Delivered

- Default and user models share a persisted list in a dedicated panel, without stars. Selecting opens the model; edit/delete are on the right of the card. Deletion requires confirmation; editing opens the complete model.
- View and edit modes preserve drafts. New or changed names are limited to 30 UTF-16 units; longer legacy names can be kept exactly. Creating a copy requires a name of at most 30 units.
- The preview beneath the chart and the metrics/capabilities panel were removed.
- F1 points support sum, mean, minimum and maximum; missing values propagate and means use the decimal rule documented in [SANDBOX_F1_AGGREGATIONS.md](SANDBOX_F1_AGGREGATIONS.md).
- Table columns can be hidden and reordered by keyboard/buttons or dragging; multi-column sorting is tri-state, with priorities and persistence. Round names use the calendar from the same season/revision.
- The explicit **Recalculate table totals** action changes query dimensions and queries the source again, including required dimensions. For example, Driver retains Season in F1. Filters remain but all become input filters; running totals, extra dimensions and table configuration are removed after a warning. The grain is persisted in existing v2/v3 model fields. This is separate from visually organizing already calculated rows.
- Pie charts allow sorting, a strictly-less-than threshold for “Other”, shown last, and legend/label options. Grouping sums already calculated slice values; it does not recalculate the mean or distinct count of the union.
- Table CSV uses commas, sorting and formula protection. Charts can be exported as SVG or PNG with an option to include the legend. Saving uses a local picker and the frontend does not send paths; no existing file is overwritten.

## Recent sandbox change

- When saving a model, the UI allows updating the selected one or creating a new one with a name, and choosing whether filters and data selection are restored on opening. `saveFilters` and `saveDataSelection` are optional boolean preferences in the same v2/v3 document; absence preserves compatibility with older models.
- Filters and selection remain in existing fields: with `saveFilters: false`, the library omits saved filters except the selection filter when `saveDataSelection: true`; with `saveDataSelection: false`, `binding.partitionIds` is saved as `[]`. No migration was created.
- The host validates and round-trips both preferences. Host export accepts a single CSV or an SVG/PNG image; it does not export a JSON manifest or JPEG.
- This change was checked by 65 library tests, 26 application tests and 44 Rust tests (one network smoke test ignored), plus the web build. Chromium with synthetic data exercised the model panel, direct loading, blocking modal, legend isolation and SVG/PNG exports. **The WebView and real native dialog still require validation.**
- Older analyses appear in the unified panel and can be opened and saved as models. At the time of this review, deletion remained unavailable in the legacy store, with an explanation in the interface; original documents were preserved. See the current note above.

## Outstanding issues and important limits

- **Organizing table rows does not recalculate totals**; use the separate **Recalculate table totals** action. It applies the selected aggregation to filtered data, rather than summing previously grouped values. Filters previously applied only to the display of running totals become input restrictions for the new query. The result is not an official classification and missing data does not become zero.
- Image export and the native dialog still need validation in the WebView and real picker, including transparency and visual fidelity. The image layout is fixed and can differ from the screen. The native command checks signatures and limits; it is not a sanitizer for arbitrary SVG.
- Older application versions may fail to list models with new pie/table settings or aggregations. Existing models are not automatically converted or rewritten; there is no automatic downgrade.
- View mode does not replace host handling of external navigation; the host must respect `onDirtyChange`. No test proves complete accessibility, real IPC, concurrency on a personal database or performance with large histories.

## Verification of this review

Sequential Node tests used `NODE_OPTIONS=--max-old-space-size=1024`, without `ulimit -v`, and a timeout: `app/tests/analysis.test.mjs` (16), `export-service` (2), and in `packages/tests`: `f1-aggregation` (2), `f1-round-labels` (1), `usability` (2), `models-ui` (1), `v2` (5), `v3-ui` (1), `pie-options` (1), `pie-options-ui` (1), `image-export` (2), `table-export` (1) and `ui` (4).

All passed. The analysis test uses Vite in middleware mode. In the first two runs, WebSocket HMR had not been explicitly disabled; Vite's code indicates it could open a temporary listener, closed when the test ended. This violated the restriction against starting servers; the initial claim that no port was opened was inaccurate. `ws: false` was added and the last run passed without that listener. Disabling dependency discovery as well reduced the measured peak from ~1 GiB to ~400 MiB in the final run. Other focused tests stayed below a 260 MiB peak per process. Measurements are peak RSS reported at the end of each process, not continuous sampling of growth during execution.

Isolated Rust tests `table_v2_tests` (1) and `export_text_tests` (2), with `CARGO_BUILD_JOBS=1`, passed using an in-memory database and temporary files. TypeScript for both workspaces and the app's Vite build passed sequentially; Vite retained a warning about a lazy chunk above 500 kB. Full suites, browser, personal database, commit and push were not run in this review. The WebSocket caveat for the first runs is noted above.
