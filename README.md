# Graph Plus Semantic

A semantic graph view for [Obsidian](https://obsidian.md), forked from [Graph Plus](https://github.com/NicolasOng/graph-plus).

Graph Plus Semantic keeps Graph Plus's typed-link model, but separates **relationship meaning**, **relationship appearance**, and **layout physics** so the same vault can be rendered as a more expressive knowledge graph.

![Obsidian](https://img.shields.io/badge/Obsidian-%23483699.svg?logo=obsidian&logoColor=white)

## First semantic-link milestone

Each typed relationship can now independently control:

- **Color**
- **Visibility**
- **Line style** - solid, dashed, or dotted in 2D and native 3D
- **Width multiplier**
- **Opacity** - per type, multiplied by shared Relation opacity in both renderers
- **Arrow behavior** — inherit global setting, force on, or force off
- **Distance multiplier**
- **Attraction multiplier**
- **Advanced directional force rules**

This makes it possible for two equally real relationships to have very different graph behavior. For example, an `enemy` relationship can be visually prominent but exert weak layout attraction, while `member_of` can exert strong organizational pull.

## Features

- **Typed links** — Links are automatically extracted from:
  - Frontmatter wikilinks (e.g. `parent: [[Note]]`)
  - Inline fields (e.g. `parent:: [[Note]]`, `[parent:: [[Note]]]`, `(parent:: [[Note]])`)
- **Explicit multi-member relations** — Opt-in relationship notes retain their authored identity and unordered membership. 3D is the primary direction, with labelled junctions, shared participants, full inspection, and normalized membership springs; 2D remains an alternate view. Either renderer can use the standard note projection.
- **Optional relationship regions** — Subtle padded enclosures behind 2D junction graphs show overlapping authored relations. Selecting a junction or relation highlights its actual displayed members; a node inside a region is not automatically a member. See [2D regions](docs/regions2d.md).
- **Optional 3D relationship enclosures** - Passive padded hull shells around displayed direct authored members in the 3D junction graph, with independent default-off controls. A nonmember inside remains a nonmember. Slice 3 is implemented in source; isolated native acceptance remains pending. See [Native 3D semantics](docs/native3d.md).
- **Semantic relationship styling** — Per-type color, line style, width, opacity, and arrow behavior
- **Shared appearance controls** — Global node/relation opacity and brightness in Display, with a reset that restores only these four controls
- **Relationship type visibility** — All on / All off for the current types, alongside individual visibility toggles
- **Per-type relationship physics** — Independent distance and attraction multipliers
- **2D and 3D rendering** — Toggle between Canvas-based 2D and WebGL 3D views
- **Middle-click focus** — Center the camera on a node or relationship junction at the current zoom without opening its note or moving the layout. Middle-drag zoom in 3D remains available, including while physics is paused.
- **Overlay sidebar** — Tune the graph without shrinking the canvas
- **Node groups** — Color nodes by query (path, tags, properties, filename)
- **Advanced link forces** — Optional directional forces per relationship type
- **Profiles** — Save/load graph projections, including relationship styling and physics
- **Non-existent nodes** — Unresolved wikilinks appear with dashed outlines (2D) or wireframe spheres (3D)

## Link Parsing

For Milestone 2A relationship-note syntax, projection behavior, diagnostics, and the membership-normalized force convention, see [Explicit hyperrelations](docs/hyperrelations.md). Ordinary-note parsing remains available alongside these records.

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
| Style | Solid, dashed, or dotted in 2D and native 3D, including curves and parallel links |
| Width × | Multiplies the global base link thickness |
| Opacity | Per-type opacity; shared Relation opacity x type opacity in both renderers |
| Arrow | Inherit global setting, force on, or force off |

Use **All on** or **All off** in the relationship-type list to show or hide every currently configured type at once. The same controls are available in the sidebar and plugin settings tab. Individual toggles remain available; bulk visibility leaves all type colors, styles, opacity, arrows, physics, and shared appearance settings intact.

### Shared Display appearance

The sidebar and plugin settings tab expose the same four controls in **Display**, for both 2D and 3D:

| Setting | Range / default | Effect |
|---|---|---|
| Node opacity | 0-1 / 1 | Transparency of entity, unresolved-node, and junction bodies |
| Relation opacity | 0-1 / 1 | Global transparency multiplied by each relationship type's opacity |
| Node brightness | 0-2 / 1 | Brightness of node bodies using their existing type/group colors |
| Relation brightness | 0-2 / 1 | Brightness of connections and ordinary arrowheads |

Brightness 1 preserves existing colors. Values below 1 blend rendered RGB toward black; values above 1 blend toward white, reaching a 50% white mix at 2. Brightness changes color independently of opacity and leaves saved relationship-type and node-group colors intact. Labels, selection highlights, 2D region fills, and 3D enclosure fills retain their own appearance.

**Reset appearance** sets only these four values to 1. The controls are saved in plugin settings and profiles; changing them or restoring an appearance-only profile preserves the quiet layout, camera, paused navigation, selection, collapsed sections, and editors/menus. Native appearance acceptance awaits Kiel's visual confirmation after the authorized live plugin update.

### Physics

| Setting | Effect |
|---|---|
| Distance × | Multiplies the global preferred link distance |
| Attraction × | Multiplies the global link attraction |
| Attraction = 0 | Keeps the relationship visible but removes its normal spring pull |

Effective spring strength is `base link force × attraction multiplier`, capped at 2 in both renderers to keep strong relationships from destabilizing the D3 simulation.

Explicit unordered membership divides this capped attraction across the authored member count. Its connections have no arrows or directional force rules; ordinary directed links keep their existing behavior.

Native 3D connections now honor solid/dashed/dotted patterns, width, and per-type opacity in scene coordinates, including curved and parallel links. Effective opacity is `shared Relation opacity x type opacity`; zero hides the connection and its arrowheads without removing the authored relationship or its springs. Ordinary links retain inherited/on/off arrows, and unordered memberships remain arrowless. Sidebar, settings-tab, and appearance-only profile changes preserve the quiet spatial layout and camera. The same shared opacity and brightness controls apply to the alternate 2D renderer. Optional 3D enclosure shells have separate appearance preferences and leave authored membership and springs unchanged. See [Native 3D semantics](docs/native3d.md) for source scope, historical native evidence, and pending isolated native acceptance. Neighborhood/path work and the full 3D milestone remain incomplete.

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
| `path:Vampire/ OR path:Demon/` | Either path family |
| `path:Vampire/ tag:kind/leader` | Both conditions |
| `(path:Vampire/ OR path:Demon/) -tag:kind/npc` | Grouped alternatives with an exclusion |

Graph search uses the same queries. Quote values containing spaces in compound queries, such as `file:"Autumn People" tag:character`. See [docs/search.md](docs/search.md) for precedence, compatibility, and the supported grammar.

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
- broader spatial-enclosure acceptance, centrality and node importance
- multiway evolution, rewrite rules, and possible Wolfram|Alpha integration

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the codebase structure.

## License

[MIT](LICENSE)
