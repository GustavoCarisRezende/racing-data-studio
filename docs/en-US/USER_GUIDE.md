# User guide — Racing Data Studio

This guide describes the desktop application's features. Source data may be incomplete. See the [testing and contribution guide](BETA.md) for installation and participation. The browser interface does not replace the desktop application for importing and analyzing local data.

## Contents

1. [Getting started and navigation](#getting-started-and-navigation)
2. [Importing and updating seasons](#importing-and-updating-seasons)
3. [Exploring events](#exploring-events)
4. [Managing snapshots](#managing-snapshots)
5. [Sandbox: filters and visualizations](#sandbox-filters-and-visualizations)
6. [Metrics and interpretation](#metrics-and-interpretation)
7. [Templates and saved analyses](#templates-and-saved-analyses)
8. [Exporting](#exporting)
9. [Quick recipes](#quick-recipes)
10. [Local data, reset and privacy](#local-data-reset-and-privacy)
11. [Troubleshooting](#troubleshooting)

## Getting started and navigation

1. Open the desktop application and select **Formula 1**, the functional category.
2. The first-run tutorial is optional: follow its highlights or select **Skip tutorial**. To restart it, open the three-line menu to the right of the language selector and choose **How to use the system**. If there are unsaved edits, confirm before restarting.
3. Choose **Português (Brasil)** or **English (US)** in the header. The current selection is not retained across restarts.
4. Use the **Data Sandbox**, **Explore events**, **Manage synchronizations**, **Manage snapshots** and **Data source** tabs. Return to the home screen via **Categories**.

On the home screen, `Ctrl+K` or `⌘K` focuses search; `Esc` removes focus. In F1 tabs, use arrows, `Home` and `End`. On desktop, `F11` toggles fullscreen. The tutorial can be dismissed and reopened; its completion marker is stored locally on the device.

## Importing and updating seasons

In **Manage synchronizations**, search for a year in the selector and confirm the desired option. Check **Only unsynchronized seasons** to restrict the list to years not yet imported; the filter depends on local data loading. Select **Import** or, for a saved year, **Update**.

Import requires internet and requests calendars and race and sprint results from Jolpica. The screen shows progress by stage and page position, not percentage; wait for completion before starting another synchronization. On error, open **Technical details**. If the remote catalog is unavailable, the alternative year list is only a convenience, not a guarantee that data exists.

A successful synchronization creates and activates a new snapshot even when its content equals the previous one; in that case the source date may remain the same. Failure preserves earlier snapshots. Updates that appear to reduce previous coverage may be rejected, even when the source made a legitimate correction. Validation does not guarantee source completeness.

Import is manual. Ongoing or future seasons may have a calendar without results. Local save time and the source date displayed in UTC have different meanings; event and analysis data dates and times are displayed without timezone conversion by the application.

## Exploring events

In **Explore events**, choose an imported season. The list uses that season's **active snapshot**. Search by event name, circuit or round; select an event to see details and results.

When sprint results exist, switch between **Race** and **Sprint**. The table shows position, driver, team, points and status as supplied by the source; missing values appear as a dash. Rows can be focused with arrows, `Home` and `End`. An event may appear as **Pending** because it is future or lacks local results; this does not establish whether the source has published them. The possible-staleness notice can be dismissed and may reappear when data changes.

## Managing snapshots

A **snapshot** is a local capture of a season. The list shows newest snapshots first; the green **Active** indicator identifies the one used for exploration, which need not be first.

| Action | Result |
|---|---|
| **Make active** | Selects an existing snapshot without copying its data. |
| **Rename** | Changes only the displayed name, not data or ID. |
| **Restore** | With confirmation, validates an earlier snapshot, creates a copy and activates it. Restoring the already active snapshot may not create a copy. |
| **Delete** | With confirmation, permanently removes the inactive snapshot and its pages. The active snapshot is protected from deletion. |
| **Create per-event copies** | On Linux, creates supplemental files from the selected snapshot; these do not restore the database. |

Names are trimmed and accept up to **80 characters**, without control characters; they must be unique within a season, case-insensitively. The automatic name `Snapshot #<ID>` is reserved. Confirming the snapshot's own automatic name without a custom name does not change metadata.

**Before deleting:** older analyses may depend on a specific snapshot. Deletion does not check those references and may prevent reopening the analysis. A snapshot in the same database is not an independent external copy.

## Sandbox: filters and visualizations

The Sandbox explores local results. On the left, **Templates** opens management; filters select seasons, drivers, teams, rounds and sessions. Results are in the center; in **Edit** mode, the right panel contains configuration. **View** hides editing; return to **Edit** to change fields and options.

The interface uses dark surfaces and highlighted controls; check labels and checkbox states, not color alone. Available options depend on context.

### Choose data and filters

- Choose one or more imported seasons and optionally use **Compare seasons** to add another. Series retain season identity.
- Quick driver, team, round and session filters have search and checkboxes. Select values or use **All · unrestricted** to remove that field's restriction.
- In **Advanced filters**, choose a field and available operator, such as value selection, text, range, null or non-null. Different filters combine with **AND**; values within one selection with **OR**. Adding another filter for the same field replaces the previous one.
- **Clear** removes user filters but retains the primary selection and any mandatory view restrictions. Advanced driver/team text filters compare against source IDs; use quick filters to search names.
- Season selection accepts up to 20 values; filter lists load options in pages and may have limits. If a query exceeds a limit, refine filters rather than assuming data was sampled.

### Configure tables and charts

Choose **Table**, **Line**, **Bar**, **Pie** or **Scatter** using the visualization controls. In the right panel, select available dimension/axis, metric, aggregation, series, comparison and additional dimensions. Availability depends on data and configuration; the application may adjust an incompatible axis when changing charts.

- **Table:** select, hide and reorder columns by dragging, buttons or `Alt+↑`/`Alt+↓`. Headers allow sorting; the page shows 50 rows at a time. The table summary re-queries at the new grouping, rather than summing displayed rows.
- **Line and bar:** use compatible axes and groupings. If there are too many series, the screen may omit some and warn. Legends can be unified or separated by season; their items filter series.
- **Pie:** choose sorting, legend and labels, and optionally group small slices into **Other**. It needs non-negative values and a positive total. **Other** sums slice values; it does not recalculate the union's average.
- **Scatter:** compares two numerical metrics, one on each axis, with their own aggregations. Missing values are omitted; each point represents the chosen group, not necessarily an individual occurrence.

Under **Chart behavior**, **Unify Events** applies only when race and sprint are explicitly selected. Simple values are recalculated from occurrences; running totals use the last chronological value, not the sum of two running totals. **Unify Legends** changes series presentation, not data. Read notices and provenance to see which snapshots were used.

## Metrics and interpretation

| Metric | Interpretation |
|---|---|
| **Points** | Sum, average, minimum or maximum of reported points. An unknown value can make the aggregate unknown. |
| **Grid position** | Average, minimum or maximum starting position; grid zero is treated as unknown. |
| **Finishing position** | Average, minimum or maximum reported position; not a championship standing. |
| **Positions gained** | Grid minus finishing position; positive means positions gained, not number of overtakes. If either position is missing, the difference is unknown. |
| **Laps completed** | Sum, average, minimum or maximum; zero laps is valid. |
| **Result occurrences** | Count of results included in the query, not sum of points. |

Positions require session identity in the grouping. Points are aggregated with decimal precision; charts use approximations for drawing, while the table provides exact values. Missing data does not automatically become zero. Results and running totals **are not official standings**: they do not necessarily apply dropped results, penalties and historical rules.

The simple running total considers the filtered population. **Points after event** uses a chronological profile; round/session filters can slice the display without cutting the calculated history. When grouped by team, the value remains the driver's, not a cumulative team total. Missing or ambiguous times may prevent calculation; gaps are not always filled.

## Templates and saved analyses

Open **Templates** on the left to create a visualization or open, edit or delete records. A new visualization starts unlinked from the previous template. The pencil beside the title edits it; unsaved changes are indicated and actions that could discard them request confirmation.

In **Save template**, when a template is selected, choose whether to update it or create another. Without a selected template, the dialog directly creates a new one without a redundant choice. The dialog lets you choose whether **filters** and **data selection** are saved: when unchecked, that part is not restored from the template; when opening in the same dataset, current selection or filters may be retained. New template names have a 30-character limit. Saving configuration does not save a copy of the data.

Templates use the `latest` policy: on opening, it resolves **active snapshots** in the chosen scope, even when historical. The open query retains that selection; to use a newly active selection, reopen the template or tab. **Restore defaults** adds only missing default templates without overwriting existing ones. Edit conflicts are reported rather than silently overwritten; refresh and reopen the current version.

Legacy analyses appear in management and can be opened or deleted with confirmation. Unlike templates, they point to specific snapshots; deleting needed snapshots may prevent opening them. Deleting an analysis or template is permanent.

## Exporting

Export requires a complete result. In **Table**, export a **CSV** with all filtered rows in order and visible columns, not just the current page. For line, bar, pie or scatter charts, choose **SVG** or **PNG** and the offered legend/label options.

In the export options dialog, **Cancel** is on the left and **Export** on the right. Then choose destination and name in the system picker. Canceling the picker does not save a file; the application does not silently overwrite an existing file. The current flow has no JPEG or separate manifest. CSV protects text that could be interpreted as formulas; empty cells may represent either empty text or missing data.

## Quick recipes

1. **See a race:** import the year in **Manage synchronizations** → open **Explore events** → choose season and event → switch race/sprint if data exists.
2. **Compare drivers:** in Sandbox, choose a season, filter drivers and select Line or Bar → choose points and driver dimension → read notices and check numbers in the table.
3. **Compare two seasons:** import both → select seasons or use **Compare seasons** → choose driver/team and metric → retain year identity in series.
4. **Return to earlier data:** in **Manage snapshots**, choose a snapshot and use **Make active**; reopen the template to resolve the active selection. To create a new active copy, use **Restore**.
5. **Reuse and share:** adjust filters and visualization → title and save a template → export CSV for numbers or SVG/PNG for an image. Check license and privacy before sharing.

## Local data, reset and privacy

Data, templates and snapshots remain on the device; importing or updating uses the network. On Linux the database is normally at `~/.local/share/org.racingdatastudio.app/categories/f1.sqlite`, or under `$XDG_DATA_HOME/org.racingdatastudio.app`. Snapshots share the database; per-event copies are supplemental and do not restore it.

The three-line desktop menu offers **Restore Default Settings**. Confirming prepares a restart and permanent deletion of local data, snapshots, templates, preferences and application local storage; canceling deletes nothing. Files exported outside application folders are not removed. Reset is native and does not require Python. `scripts/reset-local-data.py` is a separate Linux development tool; see [details and precautions](DESKTOP_USABILITY.md#native-reset-and-linux-development-cleanup) before using it.

Jolpica data has [its own terms](https://github.com/jolpica/jolpica-f1/blob/main/TERMS.md), including attribution, CC BY-NC-SA 4.0 and non-commercial use. Do not send personal databases, credentials or sensitive data when reporting problems; anonymize screenshots and logs.

## Troubleshooting

### Application updates

On supported desktop installations, open the header menu and choose **Check for
updates**. You can enable automatic downloads; installation still requires
**Install and restart** and confirmation. Save pending edits and finish
synchronization first. Updates preserve imported data and saved templates.
Unsigned local builds and MSI installations do not self-update in the initial
integration. See [release and updater status](RELEASING.md) for activation and
platform limits; the earlier test AppImage does not contain this updater.

| Situation | What to check |
|---|---|
| Catalog unavailable | Check connectivity and try later; alternative years do not guarantee availability. |
| Synchronization failed | Read **Technical details**, wait and retry. Previous snapshots are preserved; the source may impose limits. |
| No snapshot or results | Import a season on desktop; future or incomplete events may have only a calendar. |
| Empty chart or limit reached | Check metric, dates and filters; try a table or reduce seasons and categories. Missing values are not zeros. |
| Invalid pie | Choose non-negative values with a positive total or use table/bar. |
| Running total unavailable | The source may lack enough times for unambiguous order; try another metric. |
| Template conflict or analysis will not open | Refresh the list and reopen; a legacy analysis requires its original snapshots. |
| Export failed | Check complete result, size, write permission and a name that does not already exist; retry. |

To contribute, search existing reports and use the [issue template](models/CONTRIBUTION_TEMPLATE.md); complete instructions are in the [testing guide](BETA.md#contribute-without-programming).
