# F1 points aggregations

## Current behavior

Points support sum, average, minimum and maximum with null propagation and exact decimals. The pending-test description records the time of the change; check current tests before concluding what is covered.

Besides sum, the adapter offers average, minimum and maximum per group of observed results. All propagate missing points: a group containing any null value returns null, not zero or a partial average. None is an official standing. Occurrence counts retain their previous semantics.

Average uses arbitrary-size integers without conversion to floating point. Ties round away from zero, to the greater of 12 decimal places and the input precision. The result is decimal text; if it exceeds the contract limit, the query fails explicitly. The screen also reports rounding. Charts continue to use numeric approximations for rendering.

Existing queries and documents are not rewritten. Native storage was extended to accept the new options in the current formats, but older versions of the F1 application can reject models using these options, including when listing models. Native aggregation behavior still needs an isolated Rust integration test.

Multicolumn sorting, visual grouping and event names are described in [SANDBOX_TABLE_V2.md](SANDBOX_TABLE_V2.md).
