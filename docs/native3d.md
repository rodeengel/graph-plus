# Native 3D semantics - source slices 1-4

3D is the primary implementation direction; 2D remains an alternate presentation. Slice 1 adds semantic junctions and preserves interaction/layout state. Slice 2 adds spatial relationship patterns, width, and per-type opacity. Source slice 3 adds independent default-off passive spatial enclosures. Source slice 4 adds shared node/relation opacity and brightness plus bulk relationship-type visibility in both renderers, targeting version `0.3.0-semantic.3d.4`. Native appearance acceptance awaits Kiel's visual confirmation after the authorized live update; isolated spatial acceptance remains pending; neighborhood/path views and the full 3D milestone remain incomplete.

## Shared authored model and projection

Enable **3D Display → Relationship junctions** to project the same immutable semantic records used by 2D. Each explicit relation has one labelled 3D junction with its source name and authored ID. Shared participants remain single entities; ordinary directed links remain ordinary links. Disabling the setting retains the usable standard note graph and its relation-source connections. The 2D and 3D projection preferences are independent and both are saved in profiles.

Ordinary typed links use shared and per-type appearance controls directly. Enabling **Relationship junctions** or **Relationship enclosures** does not turn those links into multi-member relations: junctions and shells require explicit authored relationship notes and member records. See [Explicit hyperrelations](hyperrelations.md) for the schema. Membership is never inferred from relationship type, node groups, or scene positions.

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
effective connection opacity = shared Relation opacity x type opacity
```

Ordinary arrowheads use the same effective opacity and retain inherited/on/off behavior. Either opacity factor at zero hides the connection and its arrowheads without deleting the relationship, membership, or springs. Unordered memberships remain arrowless regardless of global/per-type arrow settings. Sidebar and settings-tab style/opacity controls are available in both views, and profiles restore those controls through visual updates.

Relationship regions remain a 2D alternate-view feature with independent preferences. Slice 2 adds only connection appearance; source slice 3 adds the optional spatial shells below.

## Shared Display opacity and brightness

**Display** contains **Node opacity**, **Relation opacity**, **Node brightness**, and **Relation brightness** in the sidebar and plugin settings tab for both 2D and 3D. Opacity ranges from 0 to 1; brightness ranges from 0 to 2. All four default to 1. The saved keys `nodeOpacity3D` and `linkOpacity` remain compatible with existing settings, with their visual effect now shared by both renderers; the brightness keys are `nodeBrightness` and `relationBrightness`.

Node opacity applies to entity, unresolved-node, and junction bodies. Relation opacity multiplies the existing type alpha for connections and their ordinary arrowheads; zero hides those renderings without removing semantics or springs. Brightness derives rendered RGB from existing type/group colors without editing those saved colors: below 1 it blends toward black, 1 is neutral, and above 1 it blends toward white by `(brightness - 1) / 2`, reaching a 50% white mix at 2. Alpha remains independent of this color adjustment. Labels, selection highlights, 2D region fills, and 3D enclosure fills retain their own appearance.

**Reset global appearance** restores only these four shared values to 1. Settings persistence and profiles include the values; older profiles missing a value retain the current/default value. Changes, reset, and appearance-only profile restoration use visual updates, retaining xyz, velocities, pins, object identity, camera, paused navigation, selection, and unrelated editors/menus. This source behavior still requires Kiel's native visual confirmation after the authorized live plugin update.

## Relationship type visibility

The existing relationship-type list offers **All on** and **All off** in both the sidebar and plugin settings tab, alongside individual visibility toggles. These actions change only the visibility flag of each currently configured type, leaving colors, patterns, width, per-type opacity, arrows, physics, and shared appearance values intact. The batch is persisted once and uses the existing visibility/filter route. It creates no authored relations, inferred membership, or new type records.

## Passive 3D relationship enclosures

Enable **Relationship enclosures** under **3D Display**, with **Relationship junctions** enabled. Enclosures default off. **Enclosure fill opacity** defaults to 0.06 and ranges from 0 to 0.3 independently of link opacity and 2D region fill. Controls are unavailable in 2D or the standard 3D graph, but saved preferences remain intact. With no graph open, the settings tab allows configuration for the default 3D junction view.

Each displayed relation junction retains its own padded convex-hull solid in actual xyz scene coordinates around only its displayed direct authored members. Overlapping or identical memberships keep separate relation identities. Around each valid participant, the helper samples a circumscribed 12-vertex icosahedron with circumradius approximately `1.258409 x max(0.5, node radius + 12)` plus an outward Float32 margin. The convex hull of those samples gives volume even for coplanar, collinear, coincident, and single-displayed-member cases. This is a faceted approximation, not an exact smooth-sphere boundary.

Invalid/non-finite xyz, negative or invalid radii, and extreme coordinates whose absolute coordinate plus enclosure extent exceeds 1,000,000 are skipped. A valid remainder can still form a shell; its geometry member count is separate from the inspector's filtered displayed/complete authored counts. No valid rendered participants, zero displayed members, a hidden junction, or a hidden relationship type produce no shell. Filters and partial counts do not change the full authored list or spring normalization.

A nonmember inside a shell remains a nonmember. A directly referenced nested relation contributes its junction position, without flattening its participants. Selection continues to highlight direct authored members and inspect the complete membership/source record. Shells are noninteractive: they add no pointer target, drag handler, simulation node, spring, topology, or inferred relation. Existing node/junction selection and background panning use their original targets.

Enclosure geometry follows current renderer positions and node sizes and stays outside the immutable semantic model. Member IDs, radii, and xyz values are cached, so quiet frames reuse the hull. Toggle, opacity, and enclosure-only profile restoration use visual updates, retaining xyz, velocities, pins, node identity, camera, paused navigation, and unrelated editors/menus. Profiles save the 3D preferences separately from 2D region settings; older profiles missing the new fields retain current/default values.

Each shell uses front-side fill with depth writing disabled and a single transparent pass, avoiding doubled fill alpha. Selection brightens its color by 30% while retaining the configured fill opacity. Because back faces are culled, a camera inside a shell may not see its interior surface. A convex enclosure can contain unrelated nodes; authored membership remains authoritative.

## Quiet layout and interaction

Pause physics stops force stepping while the render loop and camera controls remain active. Rotation, panning, zoom, focus, and inspection continue to work. Initial graph creation may warm up once to establish a useful layout; later visual changes and selection do not establish a new layout.

Visual-only settings, groups, relation selection, and appearance-only profiles keep the current renderer data, coordinates, velocities, fixed pins, and camera. Metadata refreshes with unchanged topology retain simulation-object identity. Topology changes retain surviving state where applicable; new nodes receive initialization. A mode switch creates its destination renderer, so camera preservation across mode switches is not promised.

Existing collapsed sections and group/relationship editors remain preserved. Existing saved default modes are respected; fresh installs prefer 3D.

## Acceptance fixture and evidence

Copy `tests/fixtures/hyperrelations/` plus `tests/fixtures/hyperrelations3d/Tetra.md` into an isolated vault. Tetra authors four participants—Alice, Bob, Carol, and Dan—without adding a position syntax. Triad and Liaison retain their separate original identities, and Alice's directed trusts link to Bob remains ordinary.

Let the actual 3D force layout initialize, pause it, and rotate through multiple angles. Inspect junction labels, direct-member highlights, full membership/source, and partial counts. Check solid/dashed/dotted patterns and width on ordinary, membership, curved, and parallel connections while rotating and panning. Set global and per-type opacity separately, including zero with ordinary arrows enabled. Compare sidebar changes, settings-tab changes, and appearance-only profile restoration at a non-default camera while retaining collapsed sections and selection/source actions. For source slice 3, enable enclosures and compare overlapping relations, a four-participant spatial shell, coplanar/collinear/coincident participants, one or zero displayed members, hidden junctions, and nested direct members. Place a nonmember inside an enclosure and verify selection still follows the authored list; compare pointer interaction and panning with shells on and off. For the shared Display controls, compare zero, intermediate, and neutral opacity; compare brightness 0, 1, and 2 on entity, unresolved-node, and junction bodies, connections, and ordinary arrows. Confirm labels, selection highlights, region/enclosure fills, and saved type/group colors remain unchanged, and compare the four-control reset, settings-tab changes, and appearance-only profile restoration while paused. Exercise All off / All on and individual type visibility, confirming other type fields and shared appearance values remain intact. A headless test using the installed 3D engine checks nonzero tetrahedral volume of the four participant positions; native rotation and pointer interaction are required separately and reported in the delivery record.

No live vault notes are changed or migrated. The production package remains one `graph-plus-semantic` folder containing only `main.js`, `manifest.json`, and `styles.css`.

The prior slice 1 native check on Obsidian 1.13.7 in the isolated fixture vault observed three labelled octahedral junctions, camera rotation while physics was paused, junction and list selection, direct-member highlights, complete membership/source inspection, and source-note opening. Triad and Liaison shared one Carol node and retained separate identities. Dragging Dan while paused moved Dan alone. Filtering Dan showed Liaison at 1/2 and Tetra at 3/4, retaining full authored lists and surviving positions. Changing global link opacity and restoring an appearance-only profile preserved the quiet graph, camera, and collapsed sections. Standard 3D retained relation-note spheres and connections; alternate 2D remained usable. These are observations, not user acceptance. The delivery record separately records committed-package reload checks and remaining unverified behavior.

The installed real 3D engine regression produced noncoplanar Tetra participants after the production warmup, without injected coordinates: normalized absolute tetrahedral determinant / diameter cubed was approximately 0.0934 (nonzero). Automated checks and native rotation are separate evidence. Large-vault performance, native right-drag panning, and every relationship force/style combination were not exhaustively exercised in this slice.

## Source scope and remaining acceptance

Source implementation and automated checks do not establish native Obsidian acceptance. Earlier slice 2/3 delivery had no supported desktop/browser control route or existing isolated debugging connection. New fixture rotation/panning, rendered patterns/opacity/enclosures, settings/profile, and source-action observations for slices 2 and 3 remain pending. The slice 1 observations above are historical evidence. Source slice 4 has an authorized live plugin update, with Kiel's subsequent visual confirmation still required; no new native appearance pass or full 3D acceptance is claimed.

1. **Slice 1:** 3D semantic junctions, complete inspection, normalized springs, pause/navigation, and visual-update preservation.
2. **Slice 2:** custom spatial solid/dashed/dotted patterns, world-unit width, and per-type opacity with matching ordinary arrowheads. Focused source/native evidence is recorded separately in the slice 2 delivery record; earlier native observations above remain slice 1 evidence.
3. **Source slice 3:** passive optional padded convex-hull enclosures in actual 3D scene coordinates, including overlapping identities and coplanar/collinear/coincident/partial cases. Independent 2D regions remain an alternate-view feature. Native enclosure acceptance is pending.
4. **Source slice 4:** shared Display node/relation opacity and brightness in both renderers, neutral defaults, four-control reset, quiet settings/profile restoration, and current-type All on / All off visibility. Native visual confirmation is pending.
5. **Later bounded direction:** neighborhood and path calculations implemented once in the shared semantic layer, with both renderers presenting the results.

Centrality, importance formulas, ordering/roles, inferred relations, rewrite/multiway evolution, and Wolfram integration remain outside this slice. Dependency-advisory documentation is preserved separately; compilation is not native acceptance.

## Relational visual reference

The supplied `Wolfram-ModelsForPhysics.pdf` distinguishes authored connectivity from a drawing's layout (pp. 3–4), and uses separate curved parallel paths for multiedges (p. 8). Its 3D mesh examples and separately reconstructed surfaces (pp. 78, 81–82, 88) support spatial reading without making geometry authoritative. Slice 2 supplies connection styling for that reading. Source slice 3 supplies optional derived enclosure shells around displayed direct authored members; these display assets do not reconstruct the book's surfaces or infer membership.

The book's ordered and repeated-member hyperedges (pp. 9–10) exceed the current explicitly unordered syntax. Its graph-distance neighborhoods and intrinsic dimension (pp. 93–94, 100) belong to later shared semantic analysis, not distance inferred from scene coordinates. No API integration is involved.
