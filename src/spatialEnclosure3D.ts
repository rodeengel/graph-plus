import { BufferGeometry, Color, FrontSide, Group, Mesh, MeshBasicMaterial, Vector3 } from "three";
import { ConvexGeometry } from "three/examples/jsm/geometries/ConvexGeometry.js";

export interface SpatialEnclosureMember {
  id: string;
  x: number;
  y: number;
  z: number;
  radius: number;
}

const PADDING = 12;
const MIN_RADIUS = 0.5;
// Float32 scene buffers cannot retain small solids at arbitrarily large offsets.
// Skip extreme inputs instead of inventing a location or overflowing a hull.
const MAX_COORDINATE = 1e6;
const PHI = (1 + Math.sqrt(5)) / 2;
const DIRECTION_LENGTH = Math.sqrt(1 + PHI * PHI);
const ICOSAHEDRON_INRADIUS = Math.sqrt((5 + 2 * Math.sqrt(5)) / 15);
const CIRCUMSCRIBED_FACTOR = 1 / ICOSAHEDRON_INRADIUS;
const DIRECTIONS: readonly (readonly [number, number, number])[] = [
  [0, 1, PHI], [0, -1, PHI], [0, 1, -PHI], [0, -1, -PHI],
  [1, PHI, 0], [-1, PHI, 0], [1, -PHI, 0], [-1, -PHI, 0],
  [PHI, 0, 1], [PHI, 0, -1], [-PHI, 0, 1], [-PHI, 0, -1],
];

function canDrawMember(member: SpatialEnclosureMember, padding: number): boolean {
  if (!Number.isFinite(member.x) || !Number.isFinite(member.y) || !Number.isFinite(member.z)
    || !Number.isFinite(member.radius) || member.radius < 0) return false;
  const centerMagnitude = Math.max(Math.abs(member.x), Math.abs(member.y), Math.abs(member.z));
  const radius = Math.max(MIN_RADIUS, member.radius + padding);
  const margin = Math.max(1e-5, Math.max(centerMagnitude, radius) * 1e-6);
  const extent = (radius + margin) * CIRCUMSCRIBED_FACTOR;
  return Number.isFinite(extent) && centerMagnitude + extent <= MAX_COORDINATE;
}

/**
 * Convex hull of padded participant solids in actual scene XYZ coordinates.
 *
 * Every icosahedron face is tangent to a sphere of radius (node radius +
 * padding + precision margin). At ordinary scene scales its vertices extend
 * about 26 percent beyond the padded sphere, plus the explicit margin,
 * giving a faceted shell with only twelve hull inputs per member.
 * Because the hull contains each whole solid, it encloses each padded node
 * sphere, including one, coincident, collinear and coplanar member sets.
 * A small outward margin covers Float32 rounding at supported scene offsets.
 * No membership is inferred from any object inside the resulting volume.
 */
export function buildSpatialEnclosureGeometry(
  members: readonly SpatialEnclosureMember[], padding: number = PADDING,
): ConvexGeometry | null {
  const inset = Number.isFinite(padding) ? Math.max(0, padding) : PADDING;
  const points: Vector3[] = [];
  for (const member of members) {
    if (!canDrawMember(member, inset)) continue;
    const centerMagnitude = Math.max(Math.abs(member.x), Math.abs(member.y), Math.abs(member.z));
    const paddedRadius = Math.max(MIN_RADIUS, member.radius + inset);
    const margin = Math.max(1e-5, Math.max(centerMagnitude, paddedRadius) * 1e-6);
    const scale = (paddedRadius + margin) * CIRCUMSCRIBED_FACTOR / DIRECTION_LENGTH;
    for (const direction of DIRECTIONS) {
      points.push(new Vector3(
        member.x + direction[0] * scale,
        member.y + direction[1] * scale,
        member.z + direction[2] * scale,
      ));
    }
  }
  if (!points.length) return null;
  let geometry: ConvexGeometry | null = null;
  try {
    geometry = new ConvexGeometry(points);
    const positions = geometry.getAttribute("position");
    if (!positions || positions.count < 12) {
      geometry.dispose(); return null;
    }
    for (let index = 0; index < positions.array.length; index++) {
      if (!Number.isFinite(positions.array[index])) { geometry.dispose(); return null; }
    }
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    if (!Number.isFinite(geometry.boundingSphere?.radius)) { geometry.dispose(); return null; }
    return geometry;
  } catch {
    geometry?.dispose();
    return null;
  }
}

/** Passive rendering resource for one authored relation's displayed members. */
export class SpatialEnclosure3D {
  readonly group = new Group();
  private readonly material = new MeshBasicMaterial({
    transparent: true, depthWrite: false, side: FrontSide, forceSinglePass: true,
  });
  private readonly shell = new Mesh(new BufferGeometry(), this.material);
  private readonly white = new Color("#ffffff");
  private readonly members = new Map<string, SpatialEnclosureMember>();
  private readonly disposedGeometries = new WeakSet<BufferGeometry>();
  private initialized = false;
  private cachedMemberCount = 0;
  private hasGeometry = false;
  private color = "";
  private opacity = -1;
  private selected = false;
  private disposed = false;
  private materialDisposed = false;

  constructor(color: string, opacity: number, selected: boolean = false) {
    this.group.name = "gps-spatial-enclosure";
    this.shell.name = "gps-spatial-enclosure-shell";
    // Raycaster visits invisible objects too. Enclosures are never pointer
    // targets: rotate, pan, nodes and junctions retain their existing handlers.
    this.group.raycast = () => {};
    this.shell.raycast = () => {};
    this.shell.visible = false;
    this.trackGeometry(this.shell.geometry);
    this.material.addEventListener("dispose", () => { this.materialDisposed = true; });
    this.group.add(this.shell);
    this.updateAppearance(color, opacity, selected);
  }

  /** Unchanged member IDs, XYZ and radii retain the exact same geometry. */
  updateMembers(members: readonly SpatialEnclosureMember[], authoredCount: number): boolean {
    if (this.disposed) return false;
    this.group.userData.authoredMemberCount = authoredCount;
    let changed = !this.initialized;
    let drawableCount = 0;
    for (const member of members) {
      if (!canDrawMember(member, PADDING)) continue;
      drawableCount++;
      const previous = this.members.get(member.id);
      if (!previous || previous.x !== member.x || previous.y !== member.y
        || previous.z !== member.z || previous.radius !== member.radius) changed = true;
    }
    if (drawableCount !== this.cachedMemberCount) changed = true;
    if (!changed) return false;
    this.initialized = true;
    this.cachedMemberCount = drawableCount;
    this.members.clear();
    for (const member of members) {
      if (canDrawMember(member, PADDING)) this.members.set(member.id, { ...member });
    }
    const geometry = buildSpatialEnclosureGeometry(members);
    this.disposeGeometry(this.shell.geometry);
    if (geometry) {
      this.trackGeometry(geometry);
      this.shell.geometry = geometry;
    }
    this.hasGeometry = !!geometry;
    this.shell.visible = this.hasGeometry;
    this.group.visible = this.hasGeometry && this.opacity > 0;
    // Counts used by the inspector come from the filtered authored IDs in the
    // renderer. These geometry-only counts distinguish unrepresentable XYZ.
    this.group.userData.geometryMemberCount = drawableCount;
    this.group.userData.geometryMemberIds = [...this.members.keys()];
    return true;
  }

  updateAppearance(color: string, opacity: number, selected: boolean): void {
    if (this.disposed) return;
    const alpha = Number.isFinite(opacity) ? Math.max(0, Math.min(0.3, opacity)) : 0.06;
    if (this.color === color && this.opacity === alpha && this.selected === selected) return;
    this.color = color;
    this.opacity = alpha;
    this.selected = selected;
    this.material.color.set(color);
    if (selected) this.material.color.lerp(this.white, 0.3);
    this.material.opacity = alpha;
    // One front-facing surface keeps the configured low fill from doubling.
    // Selected shells brighten without changing fill opacity or member data.
    this.shell.renderOrder = selected ? -9 : -10;
    this.group.visible = this.hasGeometry && alpha > 0;
    this.group.userData.selected = selected;
    this.group.userData.opacity = alpha;
  }

  private trackGeometry(geometry: BufferGeometry): void {
    geometry.addEventListener("dispose", () => { this.disposedGeometries.add(geometry); });
  }

  private disposeGeometry(geometry: BufferGeometry): void {
    if (!this.disposedGeometries.has(geometry)) geometry.dispose();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.group.visible = false;
    this.group.remove(this.shell);
    this.disposeGeometry(this.shell.geometry);
    if (!this.materialDisposed) this.material.dispose();
    this.members.clear();
  }
}
