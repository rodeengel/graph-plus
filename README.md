# Graph Plus

A custom graph view for [Obsidian](https://obsidian.md) with **typed, colored links** parsed from Dataview-style inline fields and frontmatter wikilinks — in both 2D and 3D.

![Obsidian](https://img.shields.io/badge/Obsidian-%23483699.svg?logo=obsidian&logoColor=white)

## Features

- **Typed links** — Links are automatically extracted from:
  - Frontmatter wikilinks (e.g. `parent: [[Note]]`)
  - Inline fields (e.g. `parent:: [[Note]]`, `[parent:: [[Note]]]`, `(parent:: [[Note]])`)
- **Color-coded link types** — Each link type gets its own color, configurable in settings
- **2D and 3D rendering** — Toggle between a Canvas-based 2D view and a WebGL 3D view
- **Overlay sidebar** — Filter and configure the graph without shrinking the canvas
- **Node groups** — Color nodes by query (path, tags, properties, filename)
- **Link forces** — Apply directional forces and distance multipliers per link type
- **Profiles** — Save and load named snapshots of all graph settings
- **Non-existent nodes** — Unresolved wikilinks appear with dashed outlines (2D) or wireframe spheres (3D)

## Link Parsing

Links are detected from two sources:

**Frontmatter** — Only `[[wikilinks]]` in YAML frontmatter create typed links:
```yaml
---
parent: "[[Parent Note]]"
related:
  - "[[Note A]]"
  - "[[Note B]]"
---
```

**Inline fields** — Dataview-style fields anywhere in the note body:
```
parent:: [[Parent Note]]
[tags:: [[Topic A]], [[Topic B]]]
(related:: [[See Also]])
```

Plain text values in frontmatter (without `[[]]`) are not treated as links.

## Sidebar & Filtering

The graph view includes an overlay sidebar for quick access to:

- **Search** — Filter nodes by name
- **Filters** — Toggle attachments, orphans, existing-only nodes
- **Link types** — Show/hide individual link types and change their colors
- **Node groups** — Color nodes matching queries like `path:folder`, `tag:#topic`, `[property:value]`
- **Display settings** — Node size, link thickness, arrows, labels, zoom thresholds
- **Forces** — Charge, centering, link strength, collision, link distance
- **Profiles** — Save/load/delete setting snapshots

## Link Forces

(Warning - Experimental)

Each link type can have a force rule that influences the graph layout. Enter rules in the **Link Forces** section of the sidebar or settings tab.

**Syntax:** `direction:magnitude` (space-separated for multiple rules)

| Rule | Effect |
|------|--------|
| `up:N` / `down:N` | Push targets up/down |
| `left:N` / `right:N` | Push targets left/right |
| `forward:N` / `backward:N` | Push targets forward/backward (3D only) |
| `distance:Nx` | Multiply link distance by N |

**Examples:**
- `down:1` — make children appear below parents
- `down:0.5 distance:2x` — gentle downward push with longer links
- `right:1 distance:1.5x` — push targets right with 1.5× link distance

## Query Syntax

Node group queries follow Obsidian conventions:

| Query | Matches |
|-------|---------|
| `path:folder` | Notes in folder (or subfolder) |
| `file:name` | Notes with name in filename |
| `tag:#topic` | Notes with tag |
| `[prop:value]` | Notes with frontmatter property |
| `bare text` | Notes with text in filename |
| `-query` | Negate any query |

## Installation

### From Community Plugins

1. Open Obsidian → Settings → Community Plugins
2. Search for **Graph Plus**
3. Install and enable

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/nicolasong/graph-link-types/releases/latest)
2. Create a folder `graph-plus` in your vault's `.obsidian/plugins/` directory
3. Copy the downloaded files into that folder
4. Enable the plugin in Settings → Community Plugins

## Usage

1. Open the command palette (`Ctrl/Cmd + P`)
2. Run **Graph Plus: Open graph view**
3. The graph view opens as a panel — use the sidebar to configure filters, colors, and forces

## License

[MIT](LICENSE)
