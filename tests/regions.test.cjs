"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const esbuild = require("esbuild");

const root = path.resolve(__dirname, "..");
const bundle = esbuild.buildSync({
  entryPoints: [path.join(root, "src", "relationRegions.ts")],
  bundle: true, platform: "node", format: "cjs", target: "es2020",
  write: false, logLevel: "silent",
});
const compiled = new Module(path.join(__dirname, "regions.generated.cjs"), module);
compiled.filename = compiled.id;
compiled.paths = module.paths;
compiled._compile(bundle.outputFiles[0].text, compiled.filename);
const { buildRelationRegionGeometry } = compiled.exports;

function area(vertices) {
  const origin = vertices[0];
  let twiceArea = 0;
  for (let index = 1; index < vertices.length - 1; index++) {
    const a = vertices[index];
    const b = vertices[index + 1];
    twiceArea += (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
  }
  return twiceArea / 2;
}
function assertUsable(geometry, kind) {
  assert.ok(geometry);
  assert.equal(geometry.kind, kind);
  assert.ok(geometry.vertices.length >= 3);
  assert.equal(geometry.vertices.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)), true);
  assert.equal(Object.values(geometry.bounds).every(Number.isFinite), true);
  assert.equal(Number.isFinite(geometry.center.x) && Number.isFinite(geometry.center.y), true);
  assert.ok(Number.isFinite(area(geometry.vertices)) && area(geometry.vertices) > 0, "nonzero counter-clockwise polygon");
  assert.ok(geometry.bounds.maxX > geometry.bounds.minX);
  assert.ok(geometry.bounds.maxY > geometry.bounds.minY);
  for (const point of geometry.vertices) {
    assert.ok(point.x >= geometry.bounds.minX && point.x <= geometry.bounds.maxX);
    assert.ok(point.y >= geometry.bounds.minY && point.y <= geometry.bounds.maxY);
  }
}
function assertInside(geometry, point) {
  for (let index = 0; index < geometry.vertices.length; index++) {
    const a = geometry.vertices[index];
    const b = geometry.vertices[(index + 1) % geometry.vertices.length];
    const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    assert.ok(cross >= -1e-7, `${JSON.stringify(point)} is outside edge ${index}`);
  }
}
function assertCircleEnclosed(geometry, member, padding) {
  assertInside(geometry, member);
  const radius = Math.max(0, member.radius ?? 0) + padding;
  for (let step = 0; step < 96; step++) {
    const angle = step * Math.PI * 2 / 96;
    assertInside(geometry, { x: member.x + radius * Math.cos(angle), y: member.y + radius * Math.sin(angle) });
  }
}

test("padded convex regions enclose unequal member circles, including a large interior circle", () => {
  const members = [
    { x: -60, y: -30, radius: 4 },
    { x: 80, y: -20, radius: 12 },
    { x: 15, y: 70, radius: 7 },
    { x: 10, y: 8, radius: 75 },
  ];
  const region = buildRelationRegionGeometry(members, 9);
  assertUsable(region, "polygon");
  for (const member of members) assertCircleEnclosed(region, member, 9);
});

test("two and collinear participants form nonzero capsule-like regions", () => {
  for (const members of [
    [{ x: 0, y: 0, radius: 3 }, { x: 90, y: 0, radius: 8 }],
    [{ x: -20, y: -40, radius: 6 }, { x: 0, y: 0, radius: 15 }, { x: 20, y: 40, radius: 2 }],
    [{ x: 3, y: -60 }, { x: 3, y: 0 }, { x: 3, y: 70 }],
  ]) {
    const region = buildRelationRegionGeometry(members, 10);
    assertUsable(region, "capsule");
    for (const member of members) assertCircleEnclosed(region, member, 10);
  }
});

test("single, coincident, and zero-padding members retain visible disc-like regions", () => {
  const single = buildRelationRegionGeometry([{ x: 10, y: -6, radius: 7 }], 4);
  assertUsable(single, "disc");
  assertCircleEnclosed(single, { x: 10, y: -6, radius: 7 }, 4);
  const coincident = [{ x: 4, y: 8, radius: 2 }, { x: 4, y: 8, radius: 19 }, { x: 4, y: 8, radius: 9 }];
  const region = buildRelationRegionGeometry(coincident, 3);
  assertUsable(region, "disc");
  assertCircleEnclosed(region, coincident[1], 3);
  assert.deepEqual(region, buildRelationRegionGeometry([coincident[1]], 3));
  assertUsable(buildRelationRegionGeometry([{ x: 0, y: 0, radius: 0 }], 0), "disc");
});

test("geometry is deterministic under membership order and duplicate centers without mutating inputs", () => {
  const members = Object.freeze([
    Object.freeze({ x: 20, y: 30, radius: 4 }),
    Object.freeze({ x: -15, y: 10, radius: 3 }),
    Object.freeze({ x: 5, y: -25, radius: 8 }),
    Object.freeze({ x: 20, y: 30, radius: 4 }),
  ]);
  const before = JSON.stringify(members);
  const one = buildRelationRegionGeometry(members);
  const two = buildRelationRegionGeometry([...members].reverse());
  assert.deepEqual(one, two);
  assert.deepEqual(one, buildRelationRegionGeometry(members.slice(0, 3)));
  one.vertices[0].x = -1000;
  assert.equal(JSON.stringify(members), before);
  assert.notDeepEqual(one, buildRelationRegionGeometry(members));
});

test("regions follow current positions and padding changes while membership objects retain their state", () => {
  const members = [{ x: 0, y: 0, radius: 4 }, { x: 100, y: 0, radius: 4 }, { x: 50, y: 60, radius: 4 }];
  const before = structuredClone(members);
  const initial = buildRelationRegionGeometry(members, 6);
  const moved = buildRelationRegionGeometry(members.map((point) => ({ ...point, x: point.x + 25, y: point.y - 40 })), 6);
  assertUsable(initial, "polygon");
  assertUsable(moved, "polygon");
  assert.equal(moved.vertices.length, initial.vertices.length);
  for (let index = 0; index < initial.vertices.length; index++) {
    assert.ok(Math.abs(moved.vertices[index].x - initial.vertices[index].x - 25) < 1e-10);
    assert.ok(Math.abs(moved.vertices[index].y - initial.vertices[index].y + 40) < 1e-10);
  }
  const larger = buildRelationRegionGeometry(members, 20);
  assert.ok(larger.bounds.minX < initial.bounds.minX);
  assert.ok(larger.bounds.maxY > initial.bounds.maxY);
  assert.deepEqual(members, before);
});

test("invalid coordinates, radii, padding, and extreme numeric input never produce invalid geometry", () => {
  assert.equal(buildRelationRegionGeometry([]), null);
  assert.equal(buildRelationRegionGeometry([{ x: NaN, y: 0 }, { x: 0, y: Infinity }]), null);
  const mixed = buildRelationRegionGeometry([{ x: NaN, y: 3 }, { x: 4, y: 5, radius: NaN }, { x: 4, y: 5, radius: -100 }], -10);
  assertUsable(mixed, "disc");
  assert.deepEqual(mixed, buildRelationRegionGeometry([{ x: 4, y: 5, radius: 0 }], 0));
  assert.deepEqual(buildRelationRegionGeometry([{ x: 0, y: 0 }], NaN), buildRelationRegionGeometry([{ x: 0, y: 0 }], 12));
  const largeOffset = buildRelationRegionGeometry([{ x: 1e16, y: 1e16, radius: 0 }], 0);
  assertUsable(largeOffset, "disc");
  assertInside(largeOffset, { x: 1e16, y: 1e16 });
  assert.equal(buildRelationRegionGeometry([{ x: Number.MAX_VALUE, y: 0, radius: Number.MAX_VALUE }], 12), null);
});
