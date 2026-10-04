# Milestone 1 dependency audit

Reviewed on 2026-10-03 against the actual npm lockfile and installed dependency sources. The original audit contained **four vulnerable package findings** (three moderate, one high), representing **four unique advisories**. The `obsidian` finding is propagation of the `moment` advisory, not a fifth advisory; `lodash-es` carries two advisories.

## Advisory inventory

| Affected locked package before remediation | Advisory and severity | Dependency path | Relevant functionality and disposition |
| --- | --- | --- | --- |
| `esbuild@0.20.2` | [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99), moderate; no CVE assigned | Root development dependency → `esbuild` | Development HTTP server CORS permits cross-origin reads. Build scripts use `context().rebuild()` and `context().watch()`, never `serve()`. The affected server functionality is not used, and esbuild is not shipped in the plugin. Updated to exact `0.25.0`, the first patched release. |
| `lodash-es@4.17.23` | [GHSA-r5fr-rjxr-66jc](https://github.com/advisories/GHSA-r5fr-rjxr-66jc) / CVE-2026-4800, high | Root → `3d-force-graph` → `kapsule` → `lodash-es`, plus the shared paths below | Code injection when `template()` receives attacker-controlled imports keys. Kapsule imports only `lodash-es/debounce.js`; plugin sources do not call `template()`. Lodash debounce is used by the installed 3D component. Updated the locked transitive package to `4.18.1`, satisfying the existing `"4"` constraint. |
| `lodash-es@4.17.23` | [GHSA-f23m-r3pf-42rh](https://github.com/advisories/GHSA-f23m-r3pf-42rh) / CVE-2026-2950, moderate | Same shared Kapsule dependency as above | Prototype property deletion through `unset()` or `omit()` array path segments. Neither function is imported by Kapsule or used by plugin sources. The same targeted `4.18.1` update addresses this advisory. |
| `moment@2.29.4`; propagated finding `obsidian@1.12.3` | [GHSA-4p3w-j4w9-5jqw](https://github.com/advisories/GHSA-4p3w-j4w9-5jqw) / CVE-2026-17495, moderate | Root development dependency → `obsidian@1.12.3` → exact `moment@2.29.4` | Server-side path traversal when `moment.locale()` receives a crafted non-string value. TypeScript reads Moment declarations through `obsidian.d.ts`; build scripts and plugin sources do not execute Moment or call `locale()`. `obsidian` is external in esbuild, so this npm Moment implementation is not bundled or installed with the three-file package. **Unresolved in the development lockfile.** |

The shared paths into `kapsule@1.16.3` are:

- `3d-force-graph@1.79.1` → `kapsule` → `lodash-es`.
- `3d-force-graph` → `three-forcegraph@1.43.1` → `kapsule` → `lodash-es`.
- `3d-force-graph` → `three-render-objects@1.40.4` → `kapsule` → `lodash-es`.
- `3d-force-graph` → `three-render-objects` → `float-tooltip@1.7.5` → `kapsule` → `lodash-es`.

## Remediation scope and remaining uncertainty

The only security dependency changes are `esbuild` and its matched optional platform binaries, and `lodash-es`. Other existing dependency versions were preserved. The [esbuild 0.25.0 release](https://github.com/evanw/esbuild/releases/tag/v0.25.0) retains the context/rebuild/watch APIs used here. Lodash's first patched release is 4.18.0; [4.18.1](https://github.com/lodash/lodash/releases/tag/4.18.1) also fixes modular distribution regressions, so the targeted update retained that compatible patch.

Moment is patched in 2.31.0, but Obsidian's API npm package pins 2.29.4 exactly. npm suggests downgrading the Obsidian API package to 0.14.5. That downgrade was rejected because it changes the project's API declaration baseline. No unsupported Moment override was introduced for a declaration-only development dependency. A future upstream API-package correction can remove this remaining finding.

This audit does not determine the Moment version embedded in the user's Obsidian application, or establish the host application's broader vulnerability status. The plugin does not invoke the affected host API. Usage conclusions above come from the actual source imports and bundle configuration; exploit attempts were not performed. Dependency audits do not prove plugin loading, rendering, or control behavior.

## Actual audit result and command budget

With Node 20.20.2 and npm 10.8.2, the focused `npm audit --json` after remediation reported **two moderate package findings, zero high findings**: `moment` and its propagated `obsidian` finding, representing one unresolved unique advisory. The audit exits 1 because those findings remain.

Measured command durations: esbuild install 2.875 seconds, targeted lodash update 3.329 seconds, and the final audit 1.520 seconds. Dependency-path inspection used `npm ls` and `npm explain` (under three seconds combined). No tests or builds were run during this audit subtask; the closeout report records the separate focused build/test results.
