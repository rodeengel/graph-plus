# Native 3D semantics — slice 1

3D is the primary implementation direction; 2D remains an alternate presentation. This first bounded slice adds semantic junctions and preserves interaction/layout state. It does **not** complete 3D styling, enclosures, or the full 3D milestone.

## Shared authored model and projection

Enable **3D Display → Relationship junctions** to project the same immutable semantic records used by 2D. Each explicit relation has one labelled 3D junction with its source name and authored ID. Shared participants remain single entities; ordinary directed links remain ordinary links. Disabling the setting retains the usable standard note graph and its relation-source connections. The 2D and 3D projection preferences are independent and both are saved in profiles.

Junction selection and the Relations list inspect the relation's ID, type, complete authored membership, displayed/total count, and source-note action. Right-clicking a junction opens its source, and middle-click focuses the current camera without moving the layout. Nested relation membership remains a direct connection to the referenced junction; it is not flattened. Filters alter displayed participants, not the authored count.

Membership springs use the established shared convention:

```text
preferred distance = base distance × type distance × legacy distance
each spoke strength = min(2, max(0, base strength × type attraction)) / authored member count
```

Membership spokes have no directional arrows or directional force rules. Hidden members do not strengthen the remaining spokes. This remains a bounded layout convention, not a physical theory.

## Quiet layout and interaction

Pause physics stops force stepping while the render loop and camera controls remain active. Rotation, panning, zoom, focus, and inspection continue to work. Initial graph creation may warm up once to establish a useful layout; later visual changes and selection do not establish a new layout.

Visual-only settings, groups, relation selection, and appearance-only profiles keep the current renderer data, coordinates, velocities, fixed pins, and camera. Metadata refreshes with unchanged topology retain simulation-object identity. Topology changes retain surviving state where applicable; new nodes receive initialization. A mode switch creates its destination renderer, so camera preservation across mode switches is not promised.

Existing collapsed sections and group/relationship editors remain preserved. Existing saved default modes are respected; fresh installs prefer 3D.

## Acceptance fixture and evidence

Copy `tests/fixtures/hyperrelations/` plus `tests/fixtures/hyperrelations3d/Tetra.md` into an isolated vault. Tetra authors four participants—Alice, Bob, Carol, and Dan—without adding a position syntax. Triad and Liaison retain their separate original identities, and Alice's directed trusts link to Bob remains ordinary.

Let the actual 3D force layout initialize, pause it, and rotate through multiple angles. Inspect junction labels, direct-member highlights, full membership/source, and partial counts. Compare appearance changes and profile restoration at a non-default camera. A headless test using the installed 3D engine checks nonzero tetrahedral volume of the four participant positions; native rotation and pointer interaction are required separately and reported in the delivery record.

No live vault notes are changed or migrated. The production package remains one `graph-plus-semantic` folder containing only `main.js`, `manifest.json`, and `styles.css`.

The focused native check on Obsidian 1.13.7 in the isolated fixture vault observed three labelled octahedral junctions, camera rotation while physics was paused, junction and list selection, direct-member highlights, complete membership/source inspection, and source-note opening. Triad and Liaison shared one Carol node and retained separate identities. Dragging Dan while paused moved Dan alone. Filtering Dan showed Liaison at 1/2 and Tetra at 3/4, retaining full authored lists and surviving positions. Changing global link opacity and restoring an appearance-only profile preserved the quiet graph, camera, and collapsed sections. Standard 3D retained relation-note spheres and connections; alternate 2D remained usable. These are observations, not user acceptance. The delivery record separately records committed-package reload checks and remaining unverified behavior.

The installed real 3D engine regression produced noncoplanar Tetra participants after the production warmup, without injected coordinates: normalized absolute tetrahedral determinant / diameter cubed was approximately 0.0934 (nonzero). Automated checks and native rotation are separate evidence. Large-vault performance, native right-drag panning, and every relationship force/style combination were not exhaustively exercised in this slice.

## Subsequent bounded slices

1. **This slice:** 3D semantic junctions, complete inspection, normalized springs, pause/navigation, and visual-update preservation.
2. **Next:** custom 3D relationship appearance for solid/dashed/dotted patterns and per-type opacity, alongside existing color/width/arrows/attraction/distance. Until then the unavailable controls are explicitly identified in the 3D UI; no parity claim is made.
3. **Then:** passive optional enclosures in genuine 3D scene coordinates, including overlapping identities and coplanar/collinear/coincident/partial cases. Existing 2D regions remain available as an alternate-view feature.
4. **Later:** neighborhood and path calculations implemented once in the shared semantic layer, with both renderers presenting the results.

Centrality, importance formulas, ordering/roles, inferred relations, rewrite/multiway evolution, and Wolfram integration remain outside this slice. Dependency-advisory documentation is preserved separately; compilation is not native acceptance.
