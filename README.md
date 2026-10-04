# Graph Plus Semantic

A semantic graph view for [Obsidian](https://obsidian.md), forked from [Graph Plus](https://github.com/NicolasOng/graph-plus).

Graph Plus Semantic keeps Graph Plus's typed-link model, but separates **relationship meaning**, **relationship appearance**, and **layout physics** so the same vault can be rendered as a more expressive knowledge graph.

![Obsidian](https://img.shields.io/badge/Obsidian-%23483699.svg?logo=obsidian&logoColor=white)

## First semantic-link milestone

Each typed relationship can now independently control:

- **Color**
- **Visibility**
- **Line style** — solid, dashed, or dotted (2D)
- **Width multiplier**
- **Opacity** (2D)
- **Arrow behavior** — inherit global setting, force on, or force off
- **Distance multiplier**
- **Attraction multiplier**
- **Advanced directional force rules**

This makes it possible for two equally real relationships to have very different graph behavior. For example, an `enemy` relationship can be visually prominent but exert weak layout attraction, while `member_of` can exert strong organizational pull.

## Features

- **Typed links** — Links are automatically extracted from:
  - Frontmatter wikilinks (e.g. `parent: [[Note]]`)
  - Inline fields (e.g. `parent:: [[Note]]`, `[parent:: [[Note]]]`, `(parent:: [[Note]])`)
- **Semantic relationship styling** — Per-type color, line style, width, opacity, and arrow behavior
- **Per-type relationship physics** — Independent distance and attraction multipliers
- **2D and 3D rendering** — Toggle between Canvas-based 2D and WebGL 3D views
- **Overlay sidebar** — Tune the graph without shrinking the canvas
- **Node groups** — Color nodes by query (path, tags, properties, filename)
- **Advanced link forces** — Optional directional forces per relationship type
- **Profiles** — Save/load graph projections, including relationship styling and physics
- **Non-existent nodes** — Unresolved wikilinks appear with dashed outlines (2D) or wireframe spheres (3D)

## Link Parsing

Links are detected from two sources.

**Frontmatter** — Only `[[wikilinks]]` in YAML frontmatter create typed links:

```yaml
---
member_of: "[[Camarilla]]"
enemy:
  - "[[Character A]]"
  - "[[Character B]]"
---
```

**Inline fields** — Dataview-style fields anywhere in the note body:

```text
member_of:: [[Camarilla]]
[enemy:: [[Character A]], [[Character B]]]
```

Plain text frontmatter values without `[[]]` are not treated as links.

## Relationship semantics

Graph Plus Semantic deliberately separates visual importance from physical attraction.

A relationship can be configured approximately like this in the UI:

```text
enemy
  style:       dashed
  width:       1.8×
  opacity:     0.85
  arrow:       on
  distance:    1.6×
  attraction:  0.25×

member_of
  style:       solid
  width:       1.3×
  opacity:     1.0
  arrow:       on
  distance:    0.7×
  attraction:  1.5×
```

The settings are stored in plugin configuration, not written into the notes themselves.

### Appearance

| Setting | Effect |
|---|---|
| Color | Relationship color |
| Style | Solid, dashed, or dotted in 2D |
| Width × | Multiplies the global base link thickness |
| Opacity | Per-type 2D opacity |
| Arrow | Inherit global setting, force on, or force off |

### Physics

| Setting | Effect |
|---|---|
| Distance × | Multiplies the global preferred link distance |
| Attraction × | Multiplies the global link attraction |
| Attraction = 0 | Keeps the relationship visible but removes its normal spring pull |

Effective spring strength is `base link force × attraction multiplier`, capped at 2 in both renderers to keep strong relationships from destabilizing the D3 simulation.

Width, arrow behavior, distance and attraction are also honored in 3D. Per-type dash patterns and opacity are currently 2D-first.

## Advanced link forces

Directional force rules from Graph Plus remain available.

**Syntax:** `direction:magnitude`

| Rule | Effect |
|---|---|
| `up:N` / `down:N` | Push targets up/down |
| `left:N` / `right:N` | Push targets left/right |
| `forward:N` / `backward:N` | Push targets forward/backward (3D only) |
| `distance:Nx` | Legacy extra distance multiplier |

The legacy `distance:Nx` rule is multiplied with the explicit **Distance ×** semantic setting.

## Node group queries

| Query | Matches |
|---|---|
| `path:folder` | Notes in folder or subfolder |
| `file:name` | Notes with name in filename |
| `tag:#topic` | Notes with tag |
| `[prop:value]` | Notes with frontmatter property |
| `bare text` | Notes with text in filename/path |
| `-query` | Negate a query |

## Development install alongside Graph Plus

This fork uses a separate Obsidian plugin ID:

```text
graph-plus-semantic
```

so it can be installed beside the original Graph Plus during development.

1. Run `npm ci`, `npm test`, and `npm run package` with Node.js 20.
2. Copy `main.js`, `manifest.json`, and `styles.css` into:
   `.obsidian/plugins/graph-plus-semantic/`
3. Enable **Graph Plus Semantic** in Obsidian.
4. Run **Graph Plus Semantic: Open Graph Plus Semantic view** from the command palette.

`npm run package` type-checks the source, builds the production bundle, and writes all three files inside `dist/graph-plus-semantic/`. The manifest ID and installation folder must both be `graph-plus-semantic`. Before updating a vault, back up its existing plugin settings (`data.json`); the package deliberately contains no settings or vault notes.

Source tests exercise parsing, Canvas drawing instructions, relationship forces, profile restoration, and settings notifications with host stubs. They do not verify Obsidian loading, actual Canvas/WebGL rendering, or pointer/keyboard behavior. Test both renderers and both settings surfaces in Obsidian before considering the milestone accepted.

## Roadmap

The semantic-link work is intended to support later graph projections without making the visualization itself authoritative.

Planned directions include:

- metadata-driven node importance/size
- neighborhood/hop views
- social / organizational / geographic / evidence projections
- graph-derived centrality and clustering overlays
- richer 3D relationship rendering

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the codebase structure.

## License

[MIT](LICENSE)
