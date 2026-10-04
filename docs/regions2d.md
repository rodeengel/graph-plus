# Optional 2D hyperrelation regions — Milestone 2B

Enable **Relationship regions** in **2D Display**, with **Relationship junctions** on. Regions default off. **Region fill opacity** is separate from link opacity; its default is 0.08 and its range is 0–0.3. The saved preference remains available when returning from standard 2D or 3D, but regions render only in the 2D junction projection. The controls communicate this limitation.

Each visible junction has its own approximate enclosure around its currently displayed, directly authored participants. Its relationship-type color is reused. Regions render behind ordinary links, junctions, nodes, and labels. Same-color or identical memberships remain separate authored records, selectable through their junctions and the Relations list. Region interiors have no click or drag handlers; background panning and node interaction use the existing targets.

Boundaries are approximate visual enclosures. A nonmember inside a region remains a nonmember. Selecting a relation highlights only its declared, displayed participants and its region, while the inspector retains the complete authored membership and source-note action. A nested relation note is one direct participant represented by its junction; its own participants are not added to the enclosing relation.

## Geometry and filtering

Geometry is computed from current renderer positions and node radii on each redraw. It is never stored in the immutable semantic model. A convex hull of circumscribed 16-sided padded discs encloses the member circles; the padding is 12 graph units. This gives an enclosing polygon for non-collinear members, a capsule-like polygon for two or collinear positions, and a small disc-like enclosure for one or coincident positions. Coincident members still count as separate authored participants. Invalid/non-finite positions are skipped until they can be drawn.

Existing filters determine displayed junctions and participants. A hidden junction or hidden relationship type has no region; its authored record remains in the Relations list. With one displayed participant the small region is marked partial. Partial displayed/total counts appear on the relationship's junction label, avoiding redundant text over shared participants; zero displayed participants produce no region. The inspector shows these counts alongside full membership, including when no region can be drawn. Unresolved participants follow the existing-only filter and retain their normal node representation.

The relation's authored member count and the 2A spring convention are unchanged. Hiding participants does not increase remaining spring strengths. Regions add no springs, simulation nodes, topology, or inferred membership.

## Updates and profiles

Region toggles, fill opacity, and selection redraw the existing 2D graph. They do not rebuild topology, reheat physics, reset the camera, or reopen unrelated menus. Geometry follows existing simulation ticks and node drags. A profile includes the region toggle and opacity; loading a profile that changes only these visual preferences uses a visual update. Profiles that change filters, projections, or force settings still apply those changes through their existing paths. Older profiles without region fields retain current region preferences.

## Focused acceptance

Reuse `tests/fixtures/hyperrelations/` in an isolated vault: Triad includes Alice/Bob/Carol, while Liaison includes Carol/Dan. Carol is the sole shared participant; Alice's directed trusts link to Bob remains an ordinary link.

- Enable regions on a paused graph; inspect both overlapping records and their separate junctions/list selections.
- Drag Dan inside Triad's enclosure, then select Triad: Dan must not receive a member highlight.
- Search `-file:Carol`: Triad has 2/3 displayed members and Liaison has 1/2. Search `file:Triad`: Triad remains inspectable with 0/3 and no region.
- Toggle regions and change fill opacity without changing quiet positions, camera, or collapsed sections. Drag an actual participant to check geometry follows it.
- Save a profile, change region preferences, reload Obsidian, and load the profile. Compare standard 2D and 3D afterward.

Focused automated tests cover geometry degeneracies and membership/drawing/update boundaries. Native observations, exact build/package results, and unexercised cases are recorded separately in the delivery report. No live-note migration or new relation syntax is part of this milestone.
