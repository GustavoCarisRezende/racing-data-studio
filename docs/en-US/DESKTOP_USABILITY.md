# Desktop usability and snapshot management

## Current behavior

The optional tutorial, snapshots, native reset, and development recovery are available. The validations described below have their own scope and date; they do not constitute full validation of every platform.

## Interface

### Short desktop windows

With at least 900 effective CSS pixels of width and about 850 pixels or less of
usable height normalized to 100% page zoom, the category title is shown at the
center of the application header.
The content keeps its semantic heading for screen readers, without displaying a
second title. Taller windows keep the original title in the content.

This uses available viewport dimensions, not physical monitor resolution:
desktop scaling and window decorations affect the usable area. Reducing page
zoom does not turn compact mode off merely because CSS viewport height increases.
Actual window resizing still updates the layout. In compact mode,
the header and navigation spacing are reduced, the empty description spacer is
removed, and the Sandbox builder heading shares a row with its view/edit controls.
The chart height adapts between 220 and 310 pixels. Controls retain their normal
size; long settings, tables, and legends remain reachable through normal scrolling.
Narrow/mobile layouts retain their stacked flow rather than clipping content.

### Interface zoom and fit to window

Desktop zoom uses the native WebView, not a CSS transform. **Ctrl +** (or **Ctrl =**)
increases zoom, **Ctrl −** decreases it, and **Ctrl 0** restores 100%; **⌘** works
on macOS. The header menu shows the current percentage with zoom/reset controls.
Manual levels range from 70% to 200%. The applied level is saved locally and
restored on startup; blocked storage does not prevent changing zoom in the session.

**Fit to window** is an explicit menu action. It checks the main visualization
(including its legend), or the current content if no visualization is present.
It measures actual layout at 100%, 95%, 90%, and 85%, stopping at the first fit
or retaining the best readable layout. This accounts for responsive breakpoints;
it does not repeatedly shrink the entire document to eliminate every scrollbar.
Long tables, legends, or settings may still require scrolling.

The chosen scale is retained, but fit mode does not keep running after resizing.
Use the action again if needed. Zoom does not change filters, models, or imported
data. Native errors leave the previous level intact when possible; preference
errors are reported separately. Native zoom controls are disabled in web previews.
The `set_application_zoom` IPC command is restricted to the main window and
validates a finite factor between 0.7 and 2.0; no unrestricted WebView permission
is granted to frontend code.

### First-use tutorial

On first use, an optional tutorial introduces the home screen, categories, synchronization, snapshots, data source, exploration, and main Sandbox controls. Popups point to controls while the rest of the screen is dimmed. “Skip tutorial” ends the guide; completion or dismissal is saved locally, separately from models.

The **How to use the system** hamburger menu, to the right of the language selector in the header, restarts the guide on the home screen. Unsaved changes require confirmation before restarting. When snapshots already exist, no new synchronization is required. Without data, the guide suggests the previous year's season: selection and import require explicit actions, and the guide advances only after success. A failure allows retrying or leaving. In a browser or when controls are unavailable, the guide provides explanations without running native operations.

Text follows the selected language. Keyboard navigation can access popup controls, focus the highlighted feature, and exit with Escape. The guide does not automatically change models, filters, or snapshots. The reset script also removes the local tutorial completion/dismissal flag.

- All Formula 1 tabs use the same width, typography, and menu position previously adopted by the Sandbox. The title and description area do not change navigation height when switching tabs.
- Year search is inside the searchable season list and filters the already loaded catalog, without network calls on each keystroke. The trigger identifies the confirmed year; typing does not automatically confirm another season. “Only unsynchronized seasons,” on the right, combines search with years without a local snapshot. Import remains disabled if the selection is invalid or the local catalog cannot be checked. Arrow keys scroll to the active option; Enter or a click confirms and returns focus to the trigger. Escape, Tab, and clicking outside close the list without confirming another year.
- Static import and latest-snapshot information is in an accordion closed by default. Progress and errors remain visible outside it. The row is left-aligned in this order: Season, selector, Update/Import, checkbox, with responsive wrapping and a 16px margin before the accordion.
- “About the project” summarizes purpose, first steps, data/privacy, contributions of new categories, and licenses in Portuguese and English. New categories require implementing and registering a module; the interface does not install them automatically.

## Snapshots

### Result fields in the Sandbox

Race and sprint results preserved in snapshots also provide starting position, classified finishing position, and completed laps. Position change is calculated as starting minus finishing position: positive means net positions gained, not an overtake count.

A reported starting position of zero is not valid for this comparison; analytical starting position and position change are unknown in that case. Missing values remain null; zero completed laps is valid. Original JSON is preserved, and no new endpoints are needed. Positions refer to each session, not championship standings. Positions and position change support average, minimum, and maximum, without sum or accumulation. Laps also support sum. When race and sprint are unified, aggregations use original occurrences from both sessions; they do not represent a single event position. For positions, prefer tables, lines, bars, or scatter plots: pie slices of averages are not parts of a whole.

SQLite remains authoritative. Migration 9 adds a separate display-name table; it does not recreate the page table or rewrite existing documents. Migration 10 records each season's active snapshot and initially selects the highest-ID version. “Make active” changes this selection without copying data; the green “Active” marker does not depend on list order. Current queries use this selection; pinned references keep using their original IDs.

Every successful synchronization creates and activates a new version, even when pages are identical. In that case, the source date is preserved. Checks against data reduction still compare against the most recently stored version, not a user-activated historical version.

- Names are trimmed, limited to 80 characters, and reject control characters. The comparison key ignores case and some Unicode variants; it is not full canonical Unicode normalization.
- Uniqueness applies within a season. Automatic names `Snapshot #<id>` are reserved to avoid visual collisions. Confirming its own unchanged automatic name does not write metadata.
- Actions appear to the right of the name in this order: Rename, Create per-event copies, Restore, Delete. The trash icon is last, with an accessible label and no additional visible text. The record occupies one horizontal row on wide screens and can wrap on smaller screens. Deletion requires modal confirmation.
- The active snapshot cannot be deleted. The legacy-analysis reference lock was removed; deleting a version referenced by a legacy record may prevent that record from reopening.
- Checks and deletion of pages and the snapshot occur in the same write transaction, under the cooperative locks used by synchronization.
- Renaming does not change IDs or filenames. Deletion does not remove already published per-event copies; these copies are not full database copies.
- Deletion errors appear inside the modal; name conflicts appear beside the edit field rather than relying on hidden technical details.

## Window and links

The model panel can delete current records and legacy analyses, using optimistic revisions to avoid deleting a version changed by another operation. Deleting or canceling deletion returns to the list. “New visualization” starts an unlinked configuration; unsaved changes require confirmation. The name is edited using the icon to the right of the title and persisted on save.

System-operation timestamps are displayed in the user's local time zone without changing stored UTC values. Event dates/times and analytical data dates are not converted. Action order depends on the dialog.

The Tauri window starts maximized, not fullscreen. F11 toggles full fullscreen and restores previous maximization. Concurrent calls and automatic key repeat do not cause overlapping toggles.

GitHub opens through a native command restricted to the `main` window, with no URL or path parameter. The URL is fixed. The web preview uses normal browser opening and receives no native permissions.

## Verification

Interaction tests should compare DOM node identity using boolean expressions so assertion diagnostics do not try to print entire jsdom trees. An incorrect assertion about the selector's parent reached the 3 GB limit; after correction, the focused suite passed with a peak of approximately 166 MB. New validations should use serial execution, a heap limit, and cgroup memory, swap, and time limits.

- Rust tests cover preservation of pages, analyses, and models in migration 9; names/conflicts; deletion protections; persistence after reopening; and page rollback after an injected failure in snapshot DELETE.
- A Chromium preview with synthetic IPC/data checked tab position, local search without extra requests, deletion protections/confirmation, renaming with preserved ID, and localized errors beside controls.
- The native Linux app, using isolated data in `/tmp/opencode`, was checked for initial maximization, entering/leaving fullscreen with F11, and activating the footer link. The test environment replaced the browser launcher to capture the correct URL without opening an external page.
- The native test used XWayland. Windows, macOS, the real external browser, and full native Wayland operation still need verification.

Automated checks use isolated data. Separately, at the user's explicit request, local application data was deleted to restart development testing.

## Native reset and Linux development cleanup

The hamburger menu also offers **Restore Default Settings**, in red after a separator. On desktop, it opens a permanent-deletion warning; opening or canceling the warning does not clear data. Confirmation prepares cleanup and application restart. Cancel receives initial focus for safety, and action order depends on the dialog.

The build does not run the Python script: it uses an equivalent native implementation and does not require Python. Cleanup runs on startup before opening the database and WebView; it includes local storage recording tutorial completion. Exports saved outside application directories are not deleted. The option is unavailable in a browser.

The native flow was checked on Linux/XWayland with isolated XDG directories: actual IPC confirmation, shutdown/reopening, removal of test files from data/configuration/cache/state, a database reset without imports, and a return to welcome screens. Neighboring files outside application roots were preserved. This test did not use real user data; restart has not yet been checked on Windows or macOS.

In development, the CLI may stop Vite when restarting the app. The reopened process after reset therefore uses a local interface copy from `app/dist`, through Tauri's internal protocol, without depending on `127.0.0.1:1420`. The development command generates this copy before starting Vite. The copy is validated before reset is accepted; if it is missing or invalid, the operation is refused without deleting data. Normal development startup still uses Vite/HMR; to return to HMR after reset, close the recovery instance and run the development command again.

With the application closed, run the optional Linux script from the repository root:

```sh
python3 -B scripts/reset-local-data.py         # preview; does not delete
python3 -B scripts/reset-local-data.py --yes   # permanent deletion
python3 -B -m unittest discover -s scripts/tests -v
```

The script removes only `org.racingdatastudio.app` directories under `XDG_DATA_HOME`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, and `XDG_STATE_HOME` (or their defaults under the user's home directory). This includes the SQLite database, snapshots, models, preferences, per-event copies, and WebView storage. It neither clears other applications nor changes source code. It rejects symbolic target directories and execution while it detects the native process running. It is not imported by the frontend or included in build resources; it is for development only.
