# Native 3D semantics - slices 1 and 2

3D is the primary implementation direction; 2D remains an alternate presentation. Slice 1 adds semantic junctions and preserves interaction/layout state. Slice 2 adds spatial relationship patterns, width, and per-type opacity. Passive 3D enclosures, neighborhood/path views, and the full 3D milestone remain incomplete.

## Shared authored model and projection

Enable **3D Display → Relationship junctions** to project the same immutable semantic records used by 2D. Each explicit relation has one labelled 3D junction with its source name and authored ID. Shared participants remain single entities; ordinary directed links remain ordinary links. Disabling the setting retains the usable standard note graph and its relation-source connections. The 2D and 3D projection preferences are independent and both are saved in profiles.

Junction selection and the Relations list inspect the relation's ID, type, complete authored membership, displayed/total count, and source-note action. Right-clicking a junction opens its source, and middle-click focuses the current camera without moving the layout. Nested relation membership remains a direct connection to the referenced junction; it is not flattened. Filters alter displayed participants, not the authored count.

Membership springs use the established shared convention:

```text
preferred distance = base distance × type distance × legacy distance
each spoke strength = min(2, max(0, base strength × type attraction)) / authored member count
```

Membership spokes have no directional arrows or directional force rules. Hidden members do not strengthen the remaining spokes. This remains a bounded layout convention, not a physical theory.

## Spatial relationship appearance

Both standard and junction 3D projections render solid, dashed, and dotted connections in actual scene coordinates. Supported Three.js camera-facing wide lines use world-unit width, multiplied by the type's width setting. Curved and parallel links follow their spatial paths, with patterns measured along those paths rather than applied as a screen overlay. Each custom connection owns its geometry and material; visual settings do not leak between types, and destruction disposes owned resources. Geometry and dash data are retained between stationary frames instead of allocating fresh dash objects each render tick.

```text
effective connection opacity = global 3D Link opacity x type opacity
```

Ordinary arrowheads use the same effective opacity and retain inherited/on/off behavior. Either opacity factor at zero hides the connection and its arrowheads without deleting the relationship, membership, or springs. Unordered memberships remain arrowless regardless of global/per-type arrow settings. Sidebar and settings-tab style/opacity controls are available in both views, and profiles restore those controls through visual updates.

Relationship regions remain a 2D alternate-view feature. No spatial enclosure or neighborhood design is added in slice 2.

## Quiet layout and interaction

Pause physics stops force stepping while the render loop and camera controls remain active. Rotation, panning, zoom, focus, and inspection continue to work. Initial graph creation may warm up once to establish a useful layout; later visual changes and selection do not establish a new layout.

Visual-only settings, groups, relation selection, and appearance-only profiles keep the current renderer data, coordinates, velocities, fixed pins, and camera. Metadata refreshes with unchanged topology retain simulation-object identity. Topology changes retain surviving state where applicable; new nodes receive initialization. A mode switch creates its destination renderer, so camera preservation across mode switches is not promised.

Existing collapsed sections and group/relationship editors remain preserved. Existing saved default modes are respected; fresh installs prefer 3D.

## Acceptance fixture and evidence

Copy `tests/fixtures/hyperrelations/` plus `tests/fixtures/hyperrelations3d/Tetra.md` into an isolated vault. Tetra authors four participants—Alice, Bob, Carol, and Dan—without adding a position syntax. Triad and Liaison retain their separate original identities, and Alice's directed trusts link to Bob remains ordinary.

Let the actual 3D force layout initialize, pause it, and rotate through multiple angles. Inspect junction labels, direct-member highlights, full membership/source, and partial counts. Check solid/dashed/dotted patterns and width on ordinary, membership, curved, and parallel connections while rotating and panning. Set global and per-type opacity separately, including zero with ordinary arrows enabled. Compare sidebar changes, settings-tab changes, and appearance-only profile restoration at a non-default camera while retaining collapsed sections and selection/source actions. A headless test using the installed 3D engine checks nonzero tetrahedral volume of the four participant positions; native rotation and pointer interaction are required separately and reported in the delivery record.

No live vault notes are changed or migrated. The production package remains one `graph-plus-semantic` folder containing only `main.js`, `manifest.json`, and `styles.css`.

The prior slice 1 native check on Obsidian 1.13.7 in the isolated fixture vault observed three labelled octahedral junctions, camera rotation while physics was paused, junction and list selection, direct-member highlights, complete membership/source inspection, and source-note opening. Triad and Liaison shared one Carol node and retained separate identities. Dragging Dan while paused moved Dan alone. Filtering Dan showed Liaison at 1/2 and Tetra at 3/4, retaining full authored lists and surviving positions. Changing global link opacity and restoring an appearance-only profile preserved the quiet graph, camera, and collapsed sections. Standard 3D retained relation-note spheres and connections; alternate 2D remained usable. These are observations, not user acceptance. The delivery record separately records committed-package reload checks and remaining unverified behavior.

The installed real 3D engine regression produced noncoplanar Tetra participants after the production warmup, without injected coordinates: normalized absolute tetrahedral determinant / diameter cubed was approximately 0.0934 (nonzero). Automated checks and native rotation are separate evidence. Large-vault performance, native right-drag panning, and every relationship force/style combination were not exhaustively exercised in this slice.

## Subsequent bounded slices

Slice 2's source checks do not establish native Obsidian acceptance. This delivery environment lacks the supported Computer Use `node_repl` tool and an existing isolated debugging connection, so new fixture rotation/panning, rendered patterns/opacity, settings/profile, and source-action observations remain pending. The slice 1 observations above are historical evidence. Live installation of slice 2 remains gated on those isolated native checks.

1. **Slice 1:** 3D semantic junctions, complete inspection, normalized springs, pause/navigation, and visual-update preservation.
2. **Slice 2:** custom spatial solid/dashed/dotted patterns, world-unit width, and per-type opacity with matching ordinary arrowheads. Focused source/native evidence is recorded separately in the slice 2 delivery record; earlier native observations above remain slice 1 evidence.
3. **Pending bounded direction:** passive optional enclosures in genuine 3D scene coordinates, including overlapping identities and coplanar/collinear/coincident/partial cases. Existing 2D regions remain available as an alternate-view feature.
4. **Later bounded direction:** neighborhood and path calculations implemented once in the shared semantic layer, with both renderers presenting the results.

Centrality, importance formulas, ordering/roles, inferred relations, rewrite/multiway evolution, and Wolfram integration remain outside this slice. Dependency-advisory documentation is preserved separately; compilation is not native acceptance.

## Relational visual reference

The supplied `Wolfram-ModelsForPhysics.pdf` distinguishes authored connectivity from a drawing's layout (pp. 3–4), and uses separate curved parallel paths for multiedges (p. 8). Its 3D mesh examples and separately reconstructed surfaces (pp. 78, 81–82, 88) support spatial reading without making geometry authoritative. Slice 2 supplies connection styling for that reading; it does not reconstruct surfaces or infer membership.

The book's ordered and repeated-member hyperedges (pp. 9–10) exceed the current explicitly unordered syntax. Its graph-distance neighborhoods and intrinsic dimension (pp. 93–94, 100) belong to later shared semantic analysis, not distance inferred from scene coordinates. No API integration is involved.
