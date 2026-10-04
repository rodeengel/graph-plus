/** Screen-independent, renderer-only geometry; no semantic records are mutated. */
export interface Point {
  x: number;
  y: number;
}

export interface RegionGeometry {
  kind: "polygon" | "capsule" | "disc";
  vertices: Point[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  center: Point;
}

interface MemberPoint extends Point {
  radius: number;
}

const DISC_SIDES = 16;
const MIN_RADIUS = 0.5;
const CIRCUMSCRIBED_FACTOR = 1 / Math.cos(Math.PI / DISC_SIDES);

/**
 * Enclose each member's circle plus padding in a convex polygon. Rounded ends
 * are approximated by circumscribed 16-gons: their edges stay outside the
 * requested circle, while vertices extend by at most about 2 percent.
 *
 * Collinear members produce a capsule-like convex region; coincident members
 * produce a disc-like region. A small minimum radius keeps zero-radius cases
 * visible. Non-finite centers are skipped and invalid radii use zero. This
 * function returns null if finite geometry cannot represent an extreme input.
 */
export function buildRelationRegionGeometry(
  members: readonly { x: number; y: number; radius?: number }[],
  padding: number = 12
): RegionGeometry | null {
  const inset = Number.isFinite(padding) ? Math.max(0, padding) : 12;
  const distinct = new Map<string, MemberPoint>();
  for (const member of members) {
    if (!Number.isFinite(member.x) || !Number.isFinite(member.y)) continue;
    const radius = Number.isFinite(member.radius) ? Math.max(0, member.radius!) : 0;
    const key = `${member.x}:${member.y}`;
    const previous = distinct.get(key);
    if (!previous || radius > previous.radius) {
      distinct.set(key, { x: member.x, y: member.y, radius });
    }
  }
  const points = [...distinct.values()].sort(comparePoints);
  if (points.length === 0) return null;

  const centerHull = convexHull(points);
  const kind = centerHull.length === 1 ? "disc" : centerHull.length === 2 ? "capsule" : "polygon";
  const padded: Point[] = [];
  for (const point of points) {
    // At large offsets, ensure the polygon is wider than floating-point spacing.
    const precisionRadius = Number.EPSILON * Math.max(Math.abs(point.x), Math.abs(point.y)) * 8;
    const radius = Math.max(MIN_RADIUS, point.radius + inset, precisionRadius) * CIRCUMSCRIBED_FACTOR;
    if (!Number.isFinite(radius)) return null;
    for (let side = 0; side < DISC_SIDES; side++) {
      const angle = 2 * Math.PI * side / DISC_SIDES;
      const vertex = { x: point.x + radius * Math.cos(angle), y: point.y + radius * Math.sin(angle) };
      if (!Number.isFinite(vertex.x) || !Number.isFinite(vertex.y)) return null;
      padded.push(vertex);
    }
  }
  const vertices = convexHull(padded);
  if (vertices.length < 3) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const vertex of vertices) {
    minX = Math.min(minX, vertex.x);
    minY = Math.min(minY, vertex.y);
    maxX = Math.max(maxX, vertex.x);
    maxY = Math.max(maxY, vertex.y);
  }
  return {
    kind, vertices, bounds: { minX, minY, maxX, maxY },
    center: { x: minX / 2 + maxX / 2, y: minY / 2 + maxY / 2 },
  };
}

function comparePoints(a: Point, b: Point): number {
  return a.x < b.x ? -1 : a.x > b.x ? 1 : a.y < b.y ? -1 : a.y > b.y ? 1 : 0;
}

/** Scale differences before multiplying so orientation does not overflow. */
function orientation(origin: Point, a: Point, b: Point): number {
  let ax = a.x - origin.x;
  let ay = a.y - origin.y;
  let bx = b.x - origin.x;
  let by = b.y - origin.y;
  if (![ax, ay, bx, by].every(Number.isFinite)) {
    const coordinateScale = Math.max(Math.abs(origin.x), Math.abs(origin.y), Math.abs(a.x), Math.abs(a.y), Math.abs(b.x), Math.abs(b.y));
    ax = a.x / coordinateScale - origin.x / coordinateScale;
    ay = a.y / coordinateScale - origin.y / coordinateScale;
    bx = b.x / coordinateScale - origin.x / coordinateScale;
    by = b.y / coordinateScale - origin.y / coordinateScale;
  }
  const scale = Math.max(Math.abs(ax), Math.abs(ay), Math.abs(bx), Math.abs(by));
  if (scale === 0) return 0;
  return (ax / scale) * (by / scale) - (ay / scale) * (bx / scale);
}

/** Andrew's monotone chain, deterministic and counter-clockwise. */
function convexHull(input: readonly Point[]): Point[] {
  const sorted = [...input].sort(comparePoints);
  const points = sorted.filter((point, index) => index === 0 || comparePoints(point, sorted[index - 1]) !== 0);
  if (points.length <= 1) return points.map((point) => ({ x: point.x, y: point.y }));
  const lower: Point[] = [];
  for (const point of points) {
    while (lower.length >= 2 && orientation(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: Point[] = [];
  for (let index = points.length - 1; index >= 0; index--) {
    const point = points[index];
    while (upper.length >= 2 && orientation(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper].map((point) => ({ x: point.x, y: point.y }));
}
