# Chart behavior: accumulations and events

## Current behavior

Driver accumulations, event unification, and legends remain available. Gap filling depends on integrity and chronology; the test results below are historical, not new validation.

## Gaps in accumulations

“Points after event” retains the previous accumulation when a driver has earlier results but is absent from an already held session containing other drivers' results. The native projection must have validated endpoint structure and pagination. Explicitly zero points also preserve the accumulation.

Future events, sessions with no results for anyone, unknown coverage, and explicitly null points are not filled. Nothing is filled before the first known participation. Pagination validation does not prove completeness: a partial list delivered by the source with consistent totals may be indistinguishable from nonparticipation.

This filling belongs to the driver accumulation profile. The team-grouped profile does not invent a team for an absent participation and may retain gaps.

In a read-only reproduction using an existing local database copy, Hadjar had 71 points at round 11, no results in rounds 12–14, and 86 at round 15. The accumulation should show 71 through the three intermediate rounds, not a break in the line. The original database was not modified for this check.

## Unify Events

The **Chart behavior** group on the right of the Sandbox contains **Unify Events**. The option is enabled when Race and Sprint are explicitly selected. Without both, the preference may remain saved, but is not sent as active query behavior.

New F1 visualizations start with **Race and Sprint selected** and the title “Event results.” Specific presets and existing models retain their own selections. In new F1 visualizations, the preference starts checked; this neither changes saved models nor unifies a query until both sessions are selected.

- Unchecked: records stay separate by session.
- Checked: sessions are consolidated for each combination of the other dimensions.
- For accumulations: uses the last chronological accumulation in the round without adding accumulations together. Example: 8 earlier points + 2 sprint points + 18 race points = **28**.
- For simple points with sum: sprint and race points total **20** in that same example.

The generic contract uses `capabilities.eventUnification` in the descriptor and `unifyEvents` in the query and visualization configuration. The property is optional in existing models; no migration or rewriting is required. The library does not know F1 session codes or calculate their chronology.

## Driver filters

The Drivers filter accepts multiple source IDs at once. The query combines those IDs with other filters and applies the selection consistently across seasons and sessions; names displayed in the legend do not replace IDs.

## Validation

The library suite passed with 68 tests, the application with 31, and Rust with 44 (one network test ignored); the web build also passed. An independent check of the existing database copy confirmed Hadjar's accumulations and the absence of duplication when unifying. A Chromium preview confirmed the checkbox in the right panel, disabled with Race alone, and reducing six series from three drivers to three series when Race and Sprint were explicit.

Automated checks and browser previews do not replace final validation in the Tauri WebView.

## Selection and configuration adjustments

- The facet-linked legend toggles multiple drivers by ID, synchronizing with the side filter and preserving seasons and sessions. Removing the last selection returns to “All”; unselected options remain available. The linked list loads up to 1,000 options.
- New visualizations start with the unification preference checked, including when its application is disabled by session selection. Existing models retain their saved preference. The group is collapsed and placed last in the right panel.
- “Table columns” appears only for tables. “Fields” uses “Primary dimension” instead of “X axis,” without duplicating the simple grouping control.
- Compatible recalculation applies selection immediately. Operations incompatible with an accumulation profile are unavailable with an explanation, rather than silently clearing the profile.

This revision passed 69 library tests and 32 application tests, plus the web build. The Chromium preview confirmed synchronized multiselection, recalculation without a button, the default checked checkbox, and conditional/ordered groups.

## Legend stability and pending-event identification

The legend reserves fixed space for color samples and uses a series reference independent of the synchronized filter. Selecting drivers does not remove other items' strokes or change widths/order. Colors and patterns are also preserved in the chart and export. Empty or failed queries keep the legend usable without showing old points. An unavailable reference retains reserved space for still-unknown series.

In **Explore events**, a red outline and **Pending** label identify future events or events without any local race/sprint results. With an explicitly zoned time, comparison uses the full instant; otherwise, it uses the calendar date. The marker neither changes nor synchronizes data.

Validation of this correction: 70 library tests, 37 application tests, and the web build passed. Chromium comparisons checked legend sizes, positions, and strokes after multiselection and the red event outlines using synthetic data. Native WebView validation remained pending.

## Unify Legends

**Unify Legends** is in **Chart behavior**. Checked (default), it groups series by driver; season appears only in hover swatches/lines. Unchecked, each line/series has its own entry with season in the label. Both modes sort labels alphabetically according to locale. `visualization.unifyLegends` is optional in v2/v3 models: absent means checked by default; no migration or rewriting of old models is required. The option changes only legend presentation, not data or query groupings. Native WebView validation of this option had not yet been performed.

In both modes, clicks continue filtering by driver ID without changing selected seasons. A Chromium preview with two seasons confirmed names without years in unified mode, individual hover titles per color, and six alphabetically sorted entries with years in separate mode (three drivers). The check passed 71 library tests, 37 application tests, and 44 Rust tests (one optional network test ignored), plus the web build.

## Tooltip for coincident lines

In line charts, the tooltip combines visible series with the same category index (X) and projected numerical value (Y). Lines with another Y at the same X, or the same Y at another X, are not grouped. Zero is valid; null points are excluded. Driver names and seasons still identify each record. Bars, pie, and scatter retain individual tooltips.

This change passed 74 library tests and 38 application tests, plus the web build. In Chromium with real ECharts SVG, a shared point displayed both series' records; another point with the same Y at a different round displayed only its own series.
