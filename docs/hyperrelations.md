# Explicit hyperrelations — Milestone 2A

One opted-in note authors one relationship with its own identity. The plugin does not infer relationships from triangles, tags, shared neighbors, or proximity, and does not invent pairwise member-to-member facts.

## Authoring

```yaml
---
graph_kind: relation
graph_id: alliance-triad
relation_type: alliance
ordered: false
members:
  - "[[Alice]]"
  - "[[Bob|Robert]]"
  - "[[Carol]]"
---
```

Use a unique, nonempty string ID and type. Members must be a YAML list of whole, explicit wikilinks to at least two distinct notes. Aliases are accepted; resolution uses Obsidian's source-relative link resolver. A missing note remains an unresolved entity with a warning and can be hidden by the existing-only filter. A note cannot include itself. Attachments, headings, blocks, duplicate members, bare text, and role-labelled objects are rejected. Quote wikilinks in YAML.

This slice supports unordered membership only. Omitted `ordered` means unordered; any value other than `false` is diagnosed. `roles`, `member_roles`, and `relation_roles` are unsupported. Invalid or duplicate-ID notes produce diagnostics and retain ordinary note parsing rather than silently becoming valid hyperrelations. All claims to a duplicate ID are rejected, including when another field in one claim is invalid. Rename or repair the source notes manually; the plugin never migrates notes.

The Relations sidebar lists valid relationships and diagnostics. Selecting a junction or its list entry shows its ID, type, complete resolved membership, source path, and an action to open the source note in a tab. Filters can hide displayed nodes or connections without changing the inspected authored record.

## Model and projections

Immutable semantic records contain entities, ordinary directed typed links, explicit relation IDs/types/members, unordered semantics, source provenance, and diagnostics. Rendering projections own separate mutable nodes, endpoints, positions, and velocities.

With **2D Display → Relationship junctions** enabled, each valid source relation note is represented by one labelled diamond junction. Its source note does not also appear as an ordinary node. Membership creates one undirected incidence connection per member; shared entities remain single nodes. Cached or body plain links to those members do not add duplicate legacy connections. Independently authored typed links still represent ordinary directed facts: the fixture Triad has `sponsor:: [[Dan]]` alongside its membership.

Both **2D Display** and **3D Display** have an independent **Relationship junctions** preference. Junctions are also supported natively in 3D, with always-visible source/ID labels, full membership inspection, displayed/total counts, and source-note opening. Disable the corresponding preference for its standard note graph: source relation notes and all membership connections remain visible. Membership is still unordered in that projection. Notes may reference another relation's source note as a member; in junction mode that endpoint is represented by the referenced junction. This does not flatten either relationship's membership.

Relationship type counts count each explicit relation once, plus its ordinary typed links, rather than counting every incidence connection as a separate relationship.

## Appearance and layout

In both views, membership connections reuse the type's color, solid/dashed/dotted line style, width, opacity, visibility, distance, and attraction. Native 3D connections occupy scene coordinates, including curved and parallel links, and use `global 3D Link opacity x type opacity`. Zero opacity hides the connection and any ordinary arrowheads without changing authored records or springs. Junctions use their relationship type color and are always labelled with the source name and authored ID. Unordered membership ignores global/per-type arrows and directional force rules. Ordinary directed links keep inherited/on/off arrows and directional behavior. Legacy extra distance multipliers still apply.

For an authored relation with `n` members:

```text
participant-to-junction preferred distance
  = base link distance × type distance multiplier × legacy distance multiplier

each membership connection's spring strength
  = min(2, max(0, base link strength × type attraction)) / n
```

The sum of configured spring strengths is bounded by 2. Filtering uses the original authored member count, so hiding a member does not strengthen the remaining connections. Attraction zero disables the membership springs. D3's degree bias, charge, centering, collision, and other relationships also influence final positions; this is a layout convention, not a physical model or Wolfram physics.

Visual changes redraw without restarting layout. Metadata-only refreshes reuse simulation objects in both renderers. Topology changes retain surviving node state where applicable. A paused topology update keeps surviving positions, while new nodes initialize. The initial paused graph may settle once. In 3D, pausing stops force stepping while rendering and camera navigation remain active. Switching between 2D and 3D creates the chosen renderer; camera preservation across that mode switch is not promised. Existing collapsed-menu and group-editor preservation remains in place. Profiles include both projection toggles and relationship appearance/force settings. See [Native 3D slices 1 and 2](native3d.md). Spatial patterns and per-type opacity are included; passive 3D enclosures and shared neighborhood/path calculations remain later bounded work. The full 3D milestone is not complete.

## Focused acceptance fixtures

`tests/fixtures/hyperrelations/` contains:

- Alice, Bob, Carol, and Dan entities; Alice has an ordinary directed `trusts` link to Bob.
- Triad (`alliance-triad`): Alice, Bob, Carol; also an ordinary sponsor link to Dan.
- Liaison (`alliance-liaison`): Carol and Dan, sharing Carol without merging relation identities.
- DuplicateOne/DuplicateTwo: a duplicate ID.
- Invalid: an invalid member; Ordered: unsupported ordering.

Copy these fixtures into an isolated vault and install the production package there. Open the graph, select each junction, verify complete membership/source actions, inspect diagnostics, and compare junction mode with standard 2D and 3D. Change a relationship's appearance separately from its force controls and check collapsed menus and camera. Do not copy or bulk-edit metadata in a live vault.

Source tests cover semantic independence, parsing/diagnostics, both projections, Canvas draw commands, bounded membership springs, selection, metadata/topology preservation, settings routing, and profile JSON restoration using host stubs. They do not establish native Obsidian loading, actual Canvas/WebGL output, pointer behavior, or user acceptance. The closeout report records those observations separately.

Optional shaded regions are described in [Milestone 2B](regions2d.md). Centrality, node importance, multiway evolution, rewrite rules, and Wolfram|Alpha integration remain subsequent work.
