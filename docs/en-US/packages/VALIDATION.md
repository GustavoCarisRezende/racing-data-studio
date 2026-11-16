# Sandbox validation record

> **Historical record:** results and outstanding work reflect each dated review, not necessarily current behavior. See [development](../DEVELOPMENT.md) and the latest contracts.

## Functional/visual review — November 12, 2026

- `packages/npm test`: **39 tests passed**; `app/npm test`: **19 tests passed** (58 total), using synthetic readers/invokes/records only.
- Package TypeScript builds and `app/npm run build`: passed. The web build retains a large lazy-chunk warning (~694.13 kB minified / 229.98 kB gzip).
- `npm run size`: renderer **582385 bytes / 200646 gzip**; UI **100291 bytes / 30062 gzip**, React external. No new dependencies, eval, or unrequested charts.
- Regression with the **actual F1 adapter and EChartsRenderer**, fixtures only: SVG pie; default/user models in the same manager; v2/v3 intact without a prompt; language switching/normalization; presets with a clean, unlinked baseline; actual edits with confirmation/Cancel; return to original configuration; rename focus; trimmed title; saving and restoring a missing default without overwriting others or losing a draft. Also tests Unicode/order/repetition in canonical filters.
- Synthetic preview with invented in-memory models/calendars; no IPC, SQLite, or personal snapshot. Connected Chromium confirmed pie with real SVG, two lines, no dirty dialog/warning, and an error-free console. Chromium capture was unavailable because the window was not visible; it was not claimed as a screenshot.
- Actual headless Firefox captures, isolated temporary profiles, waiting for SVG/table after harness actions: desktop 1672×1100 (pie), 1024×1800 (bars with configuration below), and mobile 390×3000 (stacked pie/configuration). Files: `/tmp/opencode/sandbox-ui-20261112-pie.png`, `-cumulative.png`, `-mobile.png`.
- Preview servers stopped after capture; TCP check confirmed port 4179 free. No persistent server left running. `git diff --check` passed.
- Only two host files needed changes in this round: `analysis-screen.tsx` to inject restoration into unified management and `analysis-provider.ts` for a localized measure label. Comparison with prior copies confirms no F1 algorithm change. No SQL, migration, native-backend, or real-data edits.

Handoff/diagnosis: [`SANDBOX_UI_RECOVERY.md`](../SANDBOX_UI_RECOVERY.md).
Tauri/WebKitGTK, screen readers, IPC, and personal historical data were not validated.
Existing versions/semantics and persisted models were not migrated or deleted.
Preexisting integration changes were preserved; no commit/push.

## Unblocking the accumulation contract — query/model v3

- Read the blocker in what is now [F1_SANDBOX_V2_STATUS.md](../F1_SANDBOX_V2_STATUS.md); changes in this round were limited to `packages/` and documentation. Preexisting integration changes in `app/` were preserved without editing, reverting, or committing. No real data/SQLite.
- `npm test`: **37 tests passed**, including v1/v2 regressions, the F1 season selector adapted to current facets, and five new v3 contract/UI tests.
- `npm run build`/TypeScript build run by test and size: passed.
- `npm run size`: passed. Renderer **582385 bytes / 200646 gzip**; UI **93354 bytes / 27952 gzip** (React external, minified in-memory bundles).
- `node scripts/visual-smoke.mjs --build-only`: synthetic bundle passed; `?selected` scenario adapted for season checkboxes without starting a server. This is not a new visual layout check.
- `git diff --check`: no whitespace errors.
- V3 tested with four-dimension grain, independent campaign/entity partitions, provider-ordered visits (not lexical code order), occurrence aggregation before the window, and two simultaneous post-calculation filters.
- Confirmed that showing only final visits includes earlier initial visits and showing only initial visits includes earlier final visits, not later ones. Earlier nulls remain unknown. Missing chronology **outside the displayed range**, or ambiguous chronology, rejects calculation; the UI reports the error and prevents saving without a result.
- V1/v2 models receive no profiles/extras. The v2 store/parser rejects v3 instead of discarding fields. The volatile v3 store tests v2/v3 reading, CAS, and latest roundtrip. UI tests blocked writes with a v2 store and reopening with the opt-in v3 store.

Handoff to Terra: [`SANDBOX_V3_ACCUMULATION.md`](../SANDBOX_V3_ACCUMULATION.md).
Still pending at that stage: real F1 profile/calculation/chronology, native v3 model support, backend/IPC, actual incomplete history, Tauri/WebKitGTK, and assistive accessibility.

## Library extension — November 10, 2026

- Extension scope: `packages/` and Sandbox documentation only. No changes to `app/`, app dependencies, SQLite, or personal data; no commit made.
- `npm test` in `packages/`: **32 tests passed**, including the previous 26 adapted to right-only configuration and six new v2/UI tests.
- `npm run build` (also run by test/size): TypeScript passed.
- `npm run size`: passed; minified in-memory ESM bundles with React external: renderer **582385 bytes / 200646 gzip**; UI **84025 bytes / 25430 gzip**. Pie/scatter are now intentional modules. Checks against `eval/new Function` and unrequested charts retained. These are not installer sizes.
- `git diff --check`: no whitespace errors.
- **Actual** pie/scatter SVG rendered by ECharts SSR, plus tests of null pairs, negatives, zeros, incompatible measures, and boundary magnitude.
- V1 golden JSON and legacy accumulation preserved; explicit test of a pinned analysis predating multiselection capability without silently adding groupings.
- V2 query tested with calculation before slicing, entity/campaign partitioning, descending display order without reversing the window, and response in the correct version.
- Volatile CAS store tested for create/rename/open/update/delete/conflict; updated synthetic reader demonstrates a new latest model versus an old pinned analysis.
- jsdom UI: three campaigns, actual facet search, header sorting, Alt+↑ on columns, visibility/order/sort persisted on reopening, dirty warnings, local Cancel/Confirm, `beforeunload`, host notifications, and CRUD conflicts.

No test uses production data or creates fake models inside the component. New layout captures, Tauri desktop, IPC/durable store, WebKitGTK/CSP, screen reader, zoom, and actual backend load **were not validated in this extension**. The renderer still uses ResizeObserver with the prior resize test passing. At that stage, Terra was to implement/enable F1/latest/model-store contracts according to [`SANDBOX_V2_HANDOFF.md`](../SANDBOX_V2_HANDOFF.md).

## UI and integration review — November 8, 2026

- `packages/npm test`: **26 tests passed**, including the actual F1 adapter with a synthetic reader, names, seasons, driver/team/round/session filters, presets, comparison, mirrored fields, chart/table, preview, and save/open.
- `app/npm test`: **12 tests passed**; no personal database accessed.
- `app/npm run build`: passed. Vite still warns that the analysis lazy chunk exceeds 500 kB minified (~622 kB, ~209 kB gzip); this is not a compilation error.
- `git diff --check`: no whitespace issues.
- `npm audit --omit=dev` in the package workspace: no known vulnerabilities.
- Chromium check with restrictive CSP: names correctly selected, 42 initial rows → 1 participant/season = 14 rows → two seasons = 28; two drivers/two seasons = 56 rows and four series, with no console errors in the capture.
- Layout measured in Chromium: ~322/965/322 px panels in a 1696 px viewport (20/60/20 excluding gaps), no horizontal page overflow. Three-panel layout also observed in a 1000 px viewport.
- Capture revealed an old SVG width after enlarging the window. The renderer now sends new dimensions to `resize`; the test checks 480→960 px and observer/chart disposal. After correction, measured SVG width was 909 px in a 909 px container.
- Headless Firefox captures with an isolated temporary profile: 1672×1100, 1024×1100, and 390×2600, invented data, actual checkboxes triggered by the harness, and SVG/table awaited before capture. Session files: `/tmp/opencode/rds-sandbox-desktop.png`, `rds-sandbox-compact.png`, and `rds-sandbox-mobile.png` in the same directory.
- Preview served only on loopback with automatic expiration; stopped after checking. No persistent server added.

The Tauri application was not started, no synchronization was run, and no migration applied. IPC, actual host persistence, WebKitGTK, screen readers, and large datasets still required specific validation. Screenshots demonstrate fixture layout, not correctness/completeness of real historical data. Guide: [SANDBOX_UI.md](../SANDBOX_UI.md).

## Original isolated-library record — November 7, 2026

Environment: Linux, Node 24.18.0, npm 11.16.0. No server started.
Installation reproduced with `npm ci --ignore-scripts` in the `packages/` workspace.

## Results

- `npm test`: strict TypeScript build + **23 tests passed**, no failures.
- Tests without network or database: synthetic harvest fixtures only.
- Contracts, versions, types, exact decimals, filters, nulls, comparison, required dimensions, and partitioned accumulations checked.
- React/jsdom lifecycle: query, configuration, facet, filter, save/open, export, language switching, unmounting, and stale-response disposal.
- Partial results block saving/export/charts.
- In-memory store tests compare-and-swap and conflict, not disk durability.
- Modular renderer generates actual SVG through ECharts SSR; source strings do not become HTML.
- Synthetic 5,000-row load: validation + chart model + CSV in about **42 ms** in the recorded run. Does not measure native aggregation, IPC, 5,000-point WebView rendering, or long-term RAM; not an SLA.
- `npm audit`: **0 known vulnerabilities** in the audited installed tree.
- `npm audit signatures`: **41 registry signatures verified**; **18 available attestations verified**. This does not validate all optional binaries for other platforms or prove the absence of malicious code.
- `npm run notices`: runtime/peer texts and Apache NOTICE extracted successfully.
- Diff of existing `app/`, README, LICENSE, and `.gitignore` files: empty.

## Sample bundle

`npm run size`: esbuild 0.28.2, ESM browser ES2022, minification with legal comments preserved, **React external**. No release files written.

| Sample | Minified JS | gzip |
|---|---:|---:|
| Adapter + ECharts SVG/line/bar | 555166 bytes | 191199 bytes |
| React UI + core + contracts | approximately 44 KB | approximately 14.5 KB |

These are separate measurement bundles: do not add them as an exact installer measurement. The final bundle may share modules, add React runtime, and use different tree-shaking settings. Unpacked npm size was not used to estimate the executable.

The sample check found no `eval/new Function` in emitted JavaScript or pie/map/scatter contributions in renderer output. This is not formal data-flow analysis.

## Not validated / integration responsibility

- Tauri application, IPC, SQLite, user database, synchronization, and restoration.
- CSP enforcement by WebKitGTK; jsdom and SSR do not enforce it.
- Appearance/layout at breakpoints, 200% zoom, contrast, and actual screen readers.
- Keyboard behavior in all WebView/OS combinations and formal accessibility metrics.
- Backend cancellation effectiveness, persistence after restart, native export atomicity, and cross-process concurrency.
- Performance/memory with actual seasons, hundreds of thousands of rows, high cardinality, and prolonged rendering.
- Installers, Windows/macOS, full SBOM, and legal review of real data.

Full functional limits: [README.md](README.md).
Integration and responsibilities: [SANDBOX_INTEGRATION.md](../SANDBOX_INTEGRATION.md).
