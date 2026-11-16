# Security, dependencies and distribution

## Origin and versions

Review on 07/11/2026. ECharts 6.1.0 was checked against the official npm registry
(`https://registry.npmjs.org/echarts`) and Apache documentation/repository:

- [Modular imports](https://echarts.apache.org/handbook/en/basics/import/).
- [API security](https://echarts.apache.org/handbook/en/best-practices/security/).
- [SVG/Canvas](https://echarts.apache.org/handbook/en/best-practices/canvas-vs-svg/).
- [Accessibility](https://echarts.apache.org/handbook/en/best-practices/aria/).
- [Repository](https://github.com/apache/echarts).

The lockfile records every package's URL and integrity. Integrity does not prove the absence of malicious code. Direct dependencies are pinned; transitive dependencies are pinned by the lockfile. Do not use automatic updates or `npm audit fix --force`.

Renderer runtime: ECharts 6.1.0 (Apache-2.0), zrender 6.1.0 (BSD-3-Clause), tslib 2.3.0 (0BSD). ECharts also includes BSD-3-Clause parts such as d3 in utilities. React is MIT and a peer dependency. This list does not replace license texts.

React/DOM 19.3.1, their types 19.3.0, TypeScript 7.0.2, jsdom 31.0.0 and esbuild 0.28.2 are workspace development dependencies. jsdom and esbuild should not be bundled in the application. No remote loaders, analytics instrumentation or AI packages were added.

Installation used `--ignore-scripts`. During validation, `npm audit` found no known vulnerabilities; `npm audit signatures` verified registry signatures and available attestations. Repeat before distribution: signatures and an audit without alerts are not equivalent to a full provenance review.

## Threat model

Data and configuration arrive as untrusted JSON through trusted adapters. A malicious executable JavaScript adapter, hostile getters or Proxy objects already have execution in the process; this contract is not plugin execution isolation.

- IDs are bounded; reserved prototype IDs are rejected.
- Future versions and incompatible combinations are rejected.
- Documents are projected to known fields; no callback is restored.
- The protocol has no SQL, expression language, user regex, HTML, image URLs or raw ECharts options.
- Strings render as React/SVG text. ECharts tooltips use `richText`, not HTML. There are no clickable source-provided links.
- Results are checked against requestId, selection token, schema, types, limits, groups and identities. Export and charts reject incomplete results.
- CSV prefixes an apostrophe to textual cells that spreadsheets might execute; behavior in each spreadsheet application still needs testing. Nulls and empty strings are indistinguishable in CSV. The current F1 flow does not export a manifest.
- The UI does not send data, selections or analyses to network, logs or storage. Provider, store and host determine actual I/O and must be audited separately.

The backend must repeat validation. The UI is not an authorization boundary. In Tauri, new commands need minimal capabilities; no generic SQL, filesystem or URL permission should be granted to the library.

## CSP and offline

The core does not require Workers, WASM, `eval`, inline scripts, a CDN, remote fonts or `unsafe-eval`. CSS is an external file. ECharts is imported through `core/charts/components/renderers`, with line/bar/pie/scatter and SVG registered.

Image export uses a Blob to rasterize SVG; the host CSP allows `blob:` in images. This **does not establish compatibility with Tauri CSP**. ECharts/zrender manipulate the DOM and styles at runtime; the actual distribution needs testing with the existing policy, WebKitGTK and local assets. Do not enable `unsafe-inline`, `unsafe-eval`, remote hosts or `*` merely to work around errors. jsdom/SSR do not apply the host CSP.

During integration, retain `default-src 'self'`, Tauri-authorized local scripts, local CSS and only necessary IPC in `connect-src`. Do not change CSP in this workspace. If an exception is demonstrably necessary, review the API causing it and record the minimum justification before authorizing it.

Test the built application offline and inspect console/network. The renderer never fetches data; remote calls can only come from a provider/host introduced during integration, not these packages.

## Credits and licenses

`npm run notices` prints installed LICENSE/NOTICE texts and subcomponents of ECharts, zrender, tslib, React/DOM and scheduler. The packager must preserve applicable texts in the installer and credits, including:

> Apache ECharts
> Copyright 2017-2026 The Apache Software Foundation
>
> This product includes software developed at
> The Apache Software Foundation (https://www.apache.org/).

When distributing these packages separately, also include the root Apache-2.0 `LICENSE`. They are currently private and there is no publication/release process. The notice generator assists with the current tree; it is not a complete license scanner or a replacement for an SBOM and final bundle review.

Synthetic test data is Apache-2.0. This does not change real dataset licenses: the provider must declare attribution/license/limitations in displayed metadata. The current F1 flow exports CSV or images without a manifest; attribution and license must be preserved when sharing data. Jolpica data does not become Apache-2.0.

## Before release

1. Review lockfile diff, identity, scripts and integrity.
2. Repeat vulnerability audit and available signature/attestation checks.
3. Generate an SBOM for the complete product, including integration Rust dependencies.
4. Preserve notices and licenses for all components actually distributed.
5. Test CSP, offline use, native export and screen reader in the built application.
6. Do not claim security, accessibility or multiplatform support based only on this workspace's Node suite.
