# Guide for AI agents

[Português (Brasil)](../pt-BR/AI_AGENTS.md) · [Project README](../../README.md)

## Start here

- Inspect the relevant source and tests before changing behavior. Code and current
  contracts are authoritative; dated reviews and handoffs describe their historical
  context, not necessarily the current implementation.
- See the [English documentation index](README.md), [development guide](DEVELOPMENT.md),
  [user guide](USER_GUIDE.md), [testing guide](BETA.md), and
  [contribution template](models/CONTRIBUTION_TEMPLATE.md).
- Do not change documented behavior or weaken tests merely to make a change pass.
  Preserve identifiers, API shapes, version gates, paths, and historical results.

## Repository map

- `app/src/main.tsx` and onboarding files: shell, navigation, locale and tutorial.
- `app/src/categories/f1/`: F1 screens, analysis adapter, store and export services.
- `app/src-tauri/src/f1/commands.rs`: F1 IPC boundary.
- `app/src-tauri/src/f1/repository.rs`, `jolpica.rs`, `event_archive.rs`:
  persistence, remote client and event copies.
- `app/src-tauri/src/f1/migrations/`: database schema evolution.
- `app/src-tauri/src/{main,desktop,reset}.rs`: command registration and desktop operations.
- `packages/sandbox-{contracts,core,react,echarts}/`: category-independent contracts,
  transformations, React UI and chart renderer. The F1 host injects services.
- `packages/tests/`, `app/tests/` and Rust module tests cover different boundaries.
- `docs/images/` contains shared screenshots made with synthetic data.

## Data and protocol invariants

- Imported JSON pages are the local source of truth. Queries project data in memory;
  charts do not fetch the network. Source data may be incomplete.
- Preserve exact decimal values in transport, tables and CSV; charts use numeric
  approximations. Missing values are not zero, and results are not official standings.
- Model `latest` resolves the active local snapshot, not necessarily the most recently
  saved one; resolved selections remain fixed while used. Legacy `pinned` analyses
  require their original revisions and compatible transformation.
- Snapshots preserve imported content. A successful synchronization creates and
  activates a new snapshot even for identical content; restoring an earlier snapshot
  creates a new active copy. Activation alone selects an existing snapshot.
- Protocol, document, transformation and schema versions are separate. Preserve
  compatibility gates; SQLite migrations currently reach schema 10 and reject future
  versions. Do not silently reinterpret old documents.
- Preserve event date/time semantics: do not convert source event times as though they
  were local metadata timestamps. Check the relevant formatter and tests.
- Reset and deletion are irreversible. Perform them only with explicit authorization;
  use isolated XDG directories and disposable data for tests, never a personal database.
- IPC permissions are assigned in `app/src-tauri/capabilities/f1-main.json`; inspect
  backend validation as well. Export destinations come from a native picker, not an
  arbitrary frontend path. Do not assume every F1 command has the same window guard.

## UI and validation

- Keep Portuguese and English UI behavior aligned, including variants and dialogs.
  Confirmations normally place confirm on the left and cancel on the right; the
  export-options dialog is an explicit exception: Cancel left, Export right.
  Native file pickers are platform services; test their boundaries accordingly.
- Prefer synthetic fixtures and avoid real network or user data for screenshots/tests.
- Keep DOM assertions bounded and compare boolean conditions where appropriate rather
  than serializing large DOM trees on failure.
- Do not install dependencies automatically. When dependencies are already available
  and execution is authorized, use the serial, memory-bounded commands below. Run each
  separately from the repository root; Linux examples require user systemd:

```sh
systemd-run --user --scope -p MemoryMax=3G -p MemorySwapMax=0 -p TasksMax=256 timeout 15m bash -c 'cd packages && export NODE_OPTIONS=--max-old-space-size=1536 && npm run build && node --test --test-concurrency=1 tests/*.test.mjs'
systemd-run --user --scope -p MemoryMax=3G -p MemorySwapMax=0 -p TasksMax=256 timeout 15m bash -c 'cd app && NODE_OPTIONS=--max-old-space-size=1536 node --experimental-strip-types --test --test-concurrency=1 tests/*.test.mjs'
systemd-run --user --scope -p MemoryMax=4G -p MemorySwapMax=0 -p TasksMax=256 timeout 30m bash -c 'cd app && CARGO_BUILD_JOBS=1 cargo test --manifest-path src-tauri/Cargo.toml --locked'
```

For development builds, `npm run build` in `packages/` precedes `npm run build` in
`app/`. Check the development guide for prerequisites, scope and limitations; report
what was actually run rather than inferring platform or release validation.
