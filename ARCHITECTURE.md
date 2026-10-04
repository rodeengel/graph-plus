# Architecture

This document describes the overall structure of the Graph Plus Semantic Obsidian plugin.

## Overview

Graph Plus Semantic is a fork of Graph Plus that renders typed links parsed from Dataview-style inline fields and frontmatter wikilinks. It supports both a 2D Canvas renderer and a 3D WebGL renderer, with an overlay sidebar for filtering and configuration.

The fork adds a semantic separation between:

- **relationship meaning** — the frontmatter/inline-field key that defines the link type
- **relationship appearance** — color, line style, width, opacity, arrows
- **relationship physics** — preferred distance and attraction strength

The graph layout remains a visualization of the underlying vault relationships; it is not authoritative state.

## File Structure

```text
src/
  main.ts              Plugin entry point and saved-setting migration
  types.ts             Interfaces, semantic link config, defaults, declarative settings schema
  linkParser.ts        Vault parsing, filtering, query matching
  graphView.ts         ItemView panel with semantic relationship editor
  graphRenderer2D.ts   Canvas + d3-force renderer
  graphRenderer3D.ts   WebGL renderer via 3d-force-graph
  settings.ts          Plugin settings tab
styles.css             All CSS
```

## Data Flow

```text
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

Relationship styling and physics are looked up by `link.type` in `settings.linkTypes`.

## Semantic Link Configuration

Each `LinkTypeConfig` contains:

```ts
interface LinkTypeConfig {
  color: string;
  visible: boolean;
  forceRule?: string;

  lineStyle: "solid" | "dashed" | "dotted";
  widthMultiplier: number;
  opacity: number;
  arrowMode: "inherit" | "on" | "off";

  distanceMultiplier: number;
  attraction: number;
}
```

Defaults preserve Graph Plus 0.1.0 behavior:

- solid line
- 1× width
- full opacity
- inherit the global arrow toggle
- 1× distance
- 1× attraction

`normalizeLinkTypeConfig()` migrates older saved settings by adding any missing semantic fields in memory during plugin load.

## Module Responsibilities

### `main.ts`

Plugin lifecycle. Registers the view, ribbon icon, command, and settings tab. Owns the settings object and persistence (`loadData`/`saveData`).

The semantic fork uses its own plugin/view/command IDs so it can run beside upstream Graph Plus during development.

`loadSettings()` also normalizes link-type configs saved by Graph Plus 0.1.0.

### `types.ts`

All shared interfaces (`GraphNode`, `GraphLink`, `LinkTypeConfig`, `GraphLinkTypesSettings`, etc.), semantic relationship defaults, setting migration helpers, and the declarative `SETTING_DEFS` schema.

**Declarative schema**: `SETTING_DEFS` is an array of `SettingDef` objects that describe global toggles/sliders in the UI. Both the sidebar (`graphView.ts`) and the settings tab (`settings.ts`) render controls from this array.

Relationship-type controls are dynamic and remain manually rendered because their rows are generated from vault data.

`parseForceRules()` remains available for advanced directional rules like `"down:0.5 right:1"` and legacy `distance:2x`.

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
- `ensureLinkType()` — assigns a color and complete semantic defaults to newly discovered relationship types

### `graphView.ts`

The `ItemView` subclass that owns the UI.

- **Sidebar** — overlay panel with search, filters, relationship types, display settings, forces, groups, profiles
- **Relationship editor** — per-type controls for style, width, opacity, arrows, distance and attraction
- **Renderer management** — creates/destroys the active 2D or 3D renderer, pushes filtered data to it
- **Vault event listeners** — listens for file create/delete/rename/metadata changes and debounces rebuilds (500 ms)
- **Profiles** — save/load/delete named snapshots of graph settings; semantic relationship configs are part of the snapshot

### `graphRenderer2D.ts`

Canvas-based renderer using `d3-force` for layout.

- Creates a `<canvas>` element and a d3 force simulation
- Handles zoom, drag, hover, click, and right-click context menu
- Uses `forceX`/`forceY` instead of `forceCenter`
- Draws per-type solid/dashed/dotted lines
- Applies per-type width, opacity and arrow behavior
- Uses a link-strength callback so each relationship type can multiply attraction independently
- Uses a link-distance callback so each relationship type can multiply preferred distance independently
- Custom `createLinkTypeForce()` still applies optional directional forces each tick
- Caches parsed advanced force rules

### `graphRenderer3D.ts`

WebGL renderer wrapping the `3d-force-graph` library.

- Lazy-loads `3d-force-graph` and `three`
- Non-existent nodes render as wireframe spheres
- Applies per-type width and arrow behavior
- Applies per-type distance and attraction physics
- Uses the global 3D opacity control because the stock `linkOpacity` API is global
- Per-type dashed/dotted styles remain 2D-first in this milestone
- Three.js Y+ is up (opposite to Canvas Y+ down), so directional forces flip the Y axis

### `settings.ts`

Standard Obsidian `PluginSettingTab`.

In addition to global settings and node groups, it exposes the full semantic relationship config for every discovered link type.

### `styles.css`

All CSS for the plugin. Uses Obsidian CSS variables for theme compatibility.

The overlay sidebar is widened from upstream Graph Plus to fit compact semantic relationship cards containing two-column controls.

## Key Design Patterns

**Meaning vs rendering vs physics**: the semantic relationship type is the authoritative connection category; display and layout behavior are configurable projections of it.

**Visual vs force split**: both renderers separate `updateSettings()` (cheap visual re-render) from `updateForces()` (simulation reheat).

**Per-link force callbacks**: d3's link distance and strength are functions of the link, allowing semantic relationship types to exert different physical influence without changing the vault data.

**Force rule caching**: parsed advanced force rules are cached in a `Map<string, ForceRule[]>`.

**Backwards-compatible settings migration**: older Graph Plus link configs are normalized when loaded rather than requiring the user to edit `data.json`.

**Overlay sidebar**: the sidebar is absolutely positioned over the canvas rather than beside it, so changing its width does not trigger graph relayout.
