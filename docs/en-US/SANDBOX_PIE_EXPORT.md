# Pie charts and export

## Current behavior

Pie charts, CSV and SVG/PNG are available when compatible. The current host exports one CSV or image, without a manifest or JPEG; the historical sections below describe an earlier flow.

Pie options are opt-in in `visualization.pie.version: 1`. Without this field, ordering and presentation of earlier templates remain unchanged. Editing allows ascending or descending value sorting, showing/hiding legend and labels, and grouping values **strictly below** a non-negative decimal threshold. The threshold uses a decimal point. The user applies it by leaving the field or pressing Enter; invalid input is rejected and the previous configuration retained.

The threshold and sorting compare original values as decimals, and “Other” sums them with arbitrary-size integers. “Other” always comes last, even when its sum exceeds other slices. Nulls are omitted and their count reported; negative values remain rejected. The table retains the original rows. If the total exceeds contract or chart limits, the operation fails rather than truncating or using infinity. ECharts rendering is numerically approximate even when comparison and addition were exact.

“Other” is the **sum of slice values**, not a new provider query. Thus, with averages or distinct counts, it is not the average or distinct count recalculated over the union of groups. The interface warns of this difference. Preferences remain preserved when changing chart type.

The native store validates the new field; existing templates are not rewritten merely by opening them. **Earlier application versions do not understand the field and may fail when listing new templates containing it.** There is no automatic conversion or downgrade.

## Historical F1 host CSV flow

The host offered CSV and a manifest in two separate native dialogs. Export used every row in the complete result, in table order and with table columns, not just the current page. Incomplete results were rejected. CSV uses commas and protects text cells that could be interpreted as formulas. The manifest included licenses, sources, filters, revisions and configuration; it could contain private information and needed thoughtful sharing. Nothing was sent over the network.

The backend uses official `tauri-plugin-dialog` 2.8.4 pinned in Cargo.lock. The frontend neither receives nor supplies paths; each file requires selection in a dialog. No generic filesystem or dialog permission was granted to the frontend. Writing limits each file to 16 MiB, requires the expected extension and uses exclusive creation without overwriting existing files or following a final symlink. Intermediate directories are resolved by the operating system. On Unix, the requested creation permissions are `0600`; final access control also depends on filesystem and platform. Canceling or failing the second dialog can leave the first file saved; a write failure can leave an incomplete file. New names must be selected. Leaving the screen does not necessarily close an already open native dialog; a confirmed selection may still complete the write.

The generator was tested with synthetic data and exclusive writing in a temporary directory, but **the actual picker and complete Tauri flow had not yet been validated** in a graphical environment. Dialogs, permissions and cancellation needed testing on the target platform.

## Historical image export flow

SVG, PNG and JPEG use the same ECharts model and drawing options. The exporter generates standalone SVG with its own title and legend, without interpolating user text as markup. Users independently choose whether to include legend and slice labels; these choices do not alter the saved model. PNG has a transparent background; JPEG uses a dark background for contrast. PNG/JPEG are rasterized in a local Canvas from an SVG Blob; there is no external fetch. CSP allows `blob:` only for images. Temporary URLs, handlers and Canvas are released on completion, cancellation or failure; loading and encoding have a 15-second timeout.

The image is 1200 px wide, with a 600 px chart and legend below. The legend wraps and rejects output exceeding the height limit; text, points and files have explicit limits (image up to 8 MiB). An overly long legend, Canvas failure or incompatible extension produces an error, not silent clipping. The native picker accepts only SVG, PNG or JPEG with the corresponding extension; creation remains exclusive, without overwriting files. The command validates limits, encoding and basic signature; **it is not a general sanitizer for arbitrary SVG**. Normal data safety depends on controlled SVG construction and text escaping, not acceptance of user-supplied SVG.

ECharts SVG was tested with hostile synthetic inputs, independent options, mocked Canvas rasterization, cleanup and native payload validation. **The real WebView, rasterization visual fidelity, actual transparency, CSP and integrated graphical dialog were not tested.** Those platform tests remained outstanding. Export layout uses fixed dimensions and may differ from the resized on-screen panel.
