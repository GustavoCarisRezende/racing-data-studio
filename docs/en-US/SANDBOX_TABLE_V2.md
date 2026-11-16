# Table: sorting, grouping and rounds

## Current behavior

Multicolumn sorting and summaries via a new query remain available; a summary does not sum aggregated rows and can change filter semantics. See the v3 contract for profiles.

Existing templates remain at `table.version: 1`; opening or querying them neither converts nor saves them. Adding a second sort or selecting grouping changes the edit to `table.version: 2`, with `sorts` in click-priority order and optional `groupBy`. Removing a priority preserves the order of the rest. The header cycles through ascending, descending and unsorted. Nulls come last.

Grouping is presentational: it does not sum or modify results. The grouped dimension is first in the sort; chosen priorities apply within each group. Pagination may repeat a group header on the following page. The grouped field must be visible; hiding it removes grouping.

To change the analytical grain, use the separate **Recalculate table totals** action. It removes running totals and other non-required dimensions, preserves filters as input filters, retains the selected metric/aggregation and re-queries the provider; it does not sum already aggregated rows. It discards the previous column/sort/visual-grouping configuration, with a warning before applying. For example, selecting Driver in F1 produces Driver plus mandatory Season. Resulting dimensions are persisted in the existing v2/v3 document without automatic conversion. Slices previously applied after running totals instead filter before the new aggregation.

The native store accepts and validates both versions. **Earlier application versions do not understand table v2 and may fail when listing templates that use it.** There is no automatic downgrade. Compatibility and CAS validation do not alter old templates when opening them.

In F1, the event name comes from the calendar of the same revision and season; if the calendar or name is missing, the numeric round remains. If the same number represents different names in selected seasons, the axis, facet and group header use the number rather than incorrectly assigning one event to every season. Table cells grouped by season retain that season's name. The name is an auxiliary label, not a new identity or change in grain.
