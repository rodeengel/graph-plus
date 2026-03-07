# Architecture

This document describes the overall structure of the Graph Plus Obsidian plugin.

## Overview

Graph Plus is a custom graph view that renders typed, colored links parsed from Dataview-style inline fields and frontmatter wikilinks. It supports both a 2D Canvas renderer and a 3D WebGL renderer, with an overlay sidebar for filtering and configuration.

## File Structure

```
src/
  main.ts              Plugin entry point
  types.ts             Interfaces, defaults, declarative settings schema
  linkParser.ts        Vault parsing, filtering, query matching
  graphView.ts         ItemView panel with overlay sidebar
  graphRenderer2D.ts   Canvas + d3-force renderer
  graphRenderer3D.ts   WebGL renderer via 3d-force-graph
  settings.ts          Plugin settings tab
styles.css             All CSS
```

## Data Flow

```
Vault files
    |
    v
linkParser.buildGraphData()    Parse all markdown files into nodes + typed links
    |
    v
GraphData { nodes, links }     Full unfiltered graph
    |
    v
linkParser.filterGraphData()   Apply visibility, search, orphan filters
    |
    v
GraphData (filtered)           Passed to active renderer
    |
    v
GraphRenderer2D / 3D           Renders to canvas / WebGL
```

## Module Responsibilities

### `main.ts`
Plugin lifecycle. Registers the view, ribbon icon, command, and settings tab. Owns the settings object and persistence (`loadData`/`saveData`).

### `types.ts`
All shared interfaces (`GraphNode`, `GraphLink`, `LinkTypeConfig`, `GraphLinkTypesSettings`, etc.) and the declarative `SETTING_DEFS` schema.

**Declarative schema**: `SETTING_DEFS` is an array of `SettingDef` objects that describe every toggle/slider in the UI. Both the sidebar (`graphView.ts`) and the settings tab (`settings.ts`) render controls from this array. To add a new setting: add the field to `GraphLinkTypesSettings` + `DEFAULT_SETTINGS`, then add one entry to `SETTING_DEFS`. No changes needed in the view or settings tab.

Each `SettingDef` declares:
- `section` — which UI group it belongs to (filters, display, display2d, display3d, forces)
- `effect` — what happens when it changes (rebuild, visual, force, animate)
- `renderers` — which renderer(s) it applies to (both, 2d, 3d)

Also contains `parseForceRules()` for parsing link force rule strings like `"down:0.5 distance:2x"`.

### `linkParser.ts`
Reads all markdown files in the vault and produces a `GraphData` object.

**Link sources:**
- Frontmatter `[[wikilinks]]` become typed links (key = link type)
- Inline fields (`key:: [[target]]`) become typed links
- Body `[[wikilinks]]` not covered by a typed field become untyped links

**Key functions:**
- `buildGraphData()` — full vault scan, returns all nodes and links
- `filterGraphData()` — applies visibility settings, search query, orphan filter
- `matchesQuery()` — tests a node against a query string (`path:`, `file:`, `tag:#`, `[prop:val]`, negation, bare text)
- `assignCurvatures()` — assigns curvature offsets to parallel edges between the same node pair
- `applyNodeGroups()` — colors nodes by matching against group queries

### `graphView.ts`
The `ItemView` subclass that owns the UI. Contains:

- **Sidebar** — overlay panel with search, filters, link types, display settings, forces, groups, profiles. Built from the declarative `SETTING_DEFS` schema where possible; link types, groups, and profiles are manually built due to their dynamic nature.
- **Renderer management** — creates/destroys the active 2D or 3D renderer, pushes filtered data to it.
- **Vault event listeners** — listens for file create/delete/rename/metadata changes and debounces rebuilds (500ms).
- **Profiles** — save/load/delete named snapshots of all settings.

**Setting effect dispatch**: when a setting changes, `applySettingEffect()` routes the change to the right renderer method based on the `SettingDef.effect`:
- `rebuild` — re-filters data and pushes to renderer
- `visual` — calls `renderer.updateSettings()` (re-render without physics reheat)
- `force` — calls `renderer.updateForces()` (updates force params and reheats)
- `animate` — starts/stops the simulation

### `graphRenderer2D.ts`
Canvas-based renderer using `d3-force` for layout.

- Creates a `<canvas>` element and a d3 force simulation
- Handles zoom (d3-zoom), drag (d3-drag), hover, click, and right-click context menu
- Uses `forceX`/`forceY` instead of `forceCenter` so orphan nodes are pulled to center individually
- Custom `createLinkTypeForce()` applies per-link-type directional forces each tick
- Caches parsed force rules in a `Map` to avoid re-parsing strings on every tick
- `updateSettings()` re-renders without reheating physics; `updateForces()` reheats

### `graphRenderer3D.ts`
WebGL renderer wrapping the `3d-force-graph` library.

- Lazy-loads `3d-force-graph` and `three` via dynamic `import()`
- Handles the case where `updateData()` is called before the graph is initialized (`pendingData` pattern)
- Non-existent nodes rendered as wireframe spheres via `nodeThreeObject()` using Three.js `WireframeGeometry` + `LineSegments`
- Same force rule caching and `updateSettings()`/`updateForces()` split as 2D
- Three.js Y+ is up (opposite to Canvas Y+ down), so directional forces flip the Y axis

### `settings.ts`
Standard Obsidian `PluginSettingTab`. Renders the full settings page using `SETTING_DEFS` for schema-driven sections, plus manual sections for colors, node groups, and link type configuration.

### `styles.css`
All CSS for the plugin. Uses Obsidian CSS variables (`--text-normal`, `--background-primary`, etc.) for theme compatibility. The sidebar is an absolute-positioned overlay with `backdrop-filter: blur()` and a semi-transparent background via `color-mix()`.

## Key Design Patterns

**Declarative settings**: Adding a new toggle or slider requires no UI code changes — just a type field, a default, and one `SETTING_DEFS` entry.

**Visual vs force split**: Both renderers separate `updateSettings()` (cheap visual re-render) from `updateForces()` (expensive simulation reheat). This prevents physics jitter when the user adjusts visual-only settings like node size or label visibility.

**Force rule caching**: Parsed force rules are cached in a `Map<string, ForceRule[]>` and only rebuilt when data or force settings change, avoiding per-tick string parsing.

**Overlay sidebar**: The sidebar is absolutely positioned over the canvas rather than beside it, so resizing it doesn't trigger canvas resize/relayout. Toggle button sits at z-index 20 above the sidebar at z-index 10.
