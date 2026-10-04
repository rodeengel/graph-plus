const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const esbuild = require("esbuild");

// Real Three scene objects, the installed three-forcegraph physics/digest
// engine, and real TrackballControls are exercised without constructing a
// WebGLRenderer. DOM sizing/events and label Canvas pixels are substituted;
// this is not a native Obsidian or rendered-pixel acceptance test.
const root = path.resolve(__dirname, "..");
const bundle = esbuild.buildSync({
  stdin: {
    contents: [
      'export { GraphRenderer3D } from "./src/graphRenderer3D";',
      'export { SpatialLink3D } from "./src/spatialLink3D";',
      'export { SpatialEnclosure3D, buildSpatialEnclosureGeometry } from "./src/spatialEnclosure3D";',
      'export { DEFAULT_SETTINGS, createLinkTypeConfig } from "./src/types";',
      'export { createSemanticGraph, projectGraphData, relationJunctionId } from "./src/semanticGraph";',
      'export { default as ThreeForceGraph } from "three-forcegraph";',
      'export { TrackballControls } from "three/examples/jsm/controls/TrackballControls.js";',
      'export * as THREE from "three";',
    ].join("\n"),
    resolveDir: root, loader: "ts",
  },
  bundle: true, platform: "node", format: "cjs", target: "es2020",
  write: false, logLevel: "silent",
  external: ["3d-force-graph"], supported: { "dynamic-import": false },
});
const compiled = new Module(path.join(__dirname, "three-junctions.generated.cjs"), module);
compiled.filename = compiled.id;
compiled.paths = module.paths;
const nativeRequire = compiled.require.bind(compiled);
compiled.require = (id) => id === "3d-force-graph"
  // Replace only the DOM/WebGL scene host. Production renderer initialization
  // still configures the real engine's forces and registers engine callbacks.
  ? class Headless3DHost { constructor(wrapper) { return global.__graphPlusHeadless3D(wrapper); } }
  : nativeRequire(id);
const priorWindow = global.window;
global.window = {};
try { compiled._compile(bundle.outputFiles[0].text, compiled.filename); }
finally {
  if (priorWindow === undefined) delete global.window;
  else global.window = priorWindow;
}
const { GraphRenderer3D, SpatialLink3D, SpatialEnclosure3D, buildSpatialEnclosureGeometry,
  DEFAULT_SETTINGS, createLinkTypeConfig, createSemanticGraph,
  projectGraphData, relationJunctionId, ThreeForceGraph,
  TrackballControls, THREE } = compiled.exports;

class DomSurface extends EventTarget {
  constructor(ownerDocument) {
    super(); this.ownerDocument = ownerDocument; this.style = {};
    this.clientWidth = this.clientHeight = 400; this.captures = new Set();
  }
  getBoundingClientRect() { return { left: 0, top: 0, width: 400, height: 400 }; }
  appendChild(child) { child.parentElement = this; }
  setPointerCapture(id) { this.captures.add(id); }
  releasePointerCapture(id) { this.captures.delete(id); }
  empty() {}
  remove() {}
  querySelector() { return null; }
}

function sceneDocument() {
  const doc = new DomSurface();
  doc.documentElement = { clientLeft: 0, clientTop: 0 };
  doc.createElement = (tag) => {
    const element = new DomSurface(doc);
    if (tag === "canvas") {
      element.width = element.height = 1;
      const context = {
        measureText(text) { return { width: text.length * 13 }; },
        fillRect() {}, fillText() {},
      };
      element.getContext = () => context;
    }
    return element;
  };
  return doc;
}

const entity = (name) => ({ id: `${name}.md`, name, exists: true, tags: [], properties: {}, isAttachment: false });
const authored = (id, sourceName, type, names) => Object.freeze({
  id, sourceName, sourcePath: `${sourceName}.md`, type, ordered: false,
  members: Object.freeze(names.map(name => `${name}.md`)),
});
const triad = authored("alliance-triad", "Triad", "alliance", ["Alice", "Bob", "Carol"]);
const liaison = authored("alliance-liaison", "Liaison", "alliance", ["Carol", "Dan"]);
const tetra = authored("council-tetra", "Tetra", "council", ["Alice", "Bob", "Carol", "Dan"]);

function fixtureData(extraRelations = []) {
  const relations = [triad, liaison, tetra, ...extraRelations];
  const nodes = ["Alice", "Bob", "Carol", "Dan", ...relations.map(relation => relation.sourceName)].map(entity);
  const links = [
    { source: "Alice.md", target: "Bob.md", type: "trusts", curvature: 0 },
    { source: "Triad.md", target: "Dan.md", type: "sponsor", curvature: 0 },
  ];
  return { nodes, links, semantic: createSemanticGraph(nodes, links, relations, []) };
}

const digest = () => new Promise(resolve => setTimeout(resolve, 30));
const stateOf = (nodes) => nodes.map(node => Object.fromEntries(
  ["id", "x", "y", "z", "vx", "vy", "vz", "fx", "fy", "fz", "index"].map(key => [key, node[key]])));
const cameraOf = (f) => ({ position: f.camera.position.toArray(), quaternion: f.camera.quaternion.toArray(), target: f.controls.target.toArray() });

async function fixture(run, overrides = {}, beforeReady) {
  const previous = { window: global.window, document: global.document, ResizeObserver: global.ResizeObserver,
    __graphPlusHeadless3D: global.__graphPlusHeadless3D };
  const doc = sceneDocument();
  const win = new DomSurface(doc); win.pageXOffset = win.pageYOffset = 0;
  global.window = win; global.document = doc;
  global.ResizeObserver = class { observe() {} disconnect() {} };
  const settings = { ...structuredClone(DEFAULT_SETTINGS), animate: false, hypergraph3D: true,
    linkTypes: {
      alliance: createLinkTypeConfig("#00bcd4", { attraction: 0.6, distanceMultiplier: 1.2 }),
      council: createLinkTypeConfig("#d28cff", { attraction: 0.7, distanceMultiplier: 1.1 }),
      trusts: createLinkTypeConfig("#ff9900", { arrowMode: "on" }),
    }, ...overrides };
  const opened = [], selected = [];
  const engine = new ThreeForceGraph().numDimensions(3);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 10000);
  camera.position.set(160, 220, 600);
  const canvas = new DomSurface(doc);
  const controls = new TrackballControls(camera, canvas);
  controls.target.set(3, 7, 11); controls.update();
  const scene = new THREE.Scene(); scene.add(engine);
  let replacements = 0, reheats = 0;
  let facade;
  const host = {
    camera: () => camera, controls: () => controls, scene: () => scene,
    renderer: () => ({ domElement: canvas }),
    width() { return facade; }, height() { return facade; }, backgroundColor() { return facade; },
    nodeLabel() { return facade; }, linkLabel() { return facade; },
    onNodeClick(callback) { this.nodeClick = callback; return facade; },
    onNodeRightClick(callback) { this.nodeRightClick = callback; return facade; },
    onNodeDrag(callback) { this.nodeDrag = callback; return facade; },
    pauseAnimation() { throw new Error("Layout pause froze camera/render animation"); },
    resumeAnimation() { throw new Error("Layout controls touched the render loop"); },
    graphData(...args) {
      if (args.length) { replacements++; engine.graphData(...args); return facade; }
      return engine.graphData();
    },
    d3ReheatSimulation() { reheats++; engine.d3ReheatSimulation(); return facade; },
  };
  facade = new Proxy(host, { get(target, key) {
    if (key in target) return target[key];
    const value = engine[key];
    return typeof value === "function" ? (...args) => {
      const result = value.apply(engine, args); return result === engine ? facade : result;
    } : value;
  } });
  global.__graphPlusHeadless3D = () => facade;
  const renderer = new GraphRenderer3D(new DomSurface(doc), {
    workspace: { openLinkText: (...args) => opened.push(args) },
  }, settings, relation => selected.push(relation));
  const f = { renderer, engine, settings, camera, controls, canvas, doc, opened, selected,
    replacements: () => replacements, reheats: () => reheats,
    async apply(data) { renderer.updateData(data); await digest(); engine.tickFrame(); },
    async visual() { renderer.updateSettings(); await digest(); engine.tickFrame(); },
  };
  try {
    beforeReady?.(f);
    await digest();
    assert.strictEqual(renderer.graph, facade, "Production 3D initialization must reach the real headless engine");
    await run(f);
  }
  finally {
    renderer.destroyed = true;
    renderer.disposeSpatialLinks();
    renderer.disposeSpatialEnclosures();
    controls.dispose();
    engine.graphData({ nodes: [], links: [] }); await digest();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete global[key]; else global[key] = value;
    }
  }
}

test("pending 3D initialization exposes complete authored counts and retains selection until scene objects are ready", async () => {
  const projected = projectGraphData(fixtureData(), true);
  const visible = new Set(projected.nodes.filter(node => node.id !== "Carol.md").map(node => node.id));
  const partial = { ...projected, nodes: projected.nodes.filter(node => visible.has(node.id)),
    links: projected.links.filter(link => visible.has(link.source) && visible.has(link.target)) };
  await fixture(async f => {
    f.engine.tickFrame();
    assert.equal(f.renderer.selectedRelationId, triad.id);
    assert.deepEqual(f.renderer.getRelationDisplayCount(triad.id), { displayed: 2, total: 3 });
    const nodes = f.engine.graphData().nodes;
    const junction = nodes.find(node => node.relation?.id === triad.id);
    assert.equal(junction.__threeObj.userData.displayedMemberCount, 2);
    assert.equal(junction.__threeObj.userData.totalMemberCount, 3);
    assert.ok(junction.__threeObj.getObjectByName("gps-semantic-selection"));
    const highlighted = nodes.filter(node => node.__threeObj.getObjectByName("gps-semantic-selection")?.userData.directMember)
      .map(node => node.id).sort();
    assert.deepEqual(highlighted, ["Alice.md", "Bob.md"]);
  }, {}, f => {
    assert.equal(f.renderer.graph, null, "The check runs before the production async constructor resolves");
    f.renderer.updateData(partial);
    assert.deepEqual(f.renderer.getRelationDisplayCount(triad.id), { displayed: 2, total: 3 });
    assert.deepEqual(f.renderer.getRelationDisplayCount(liaison.id), { displayed: 1, total: 2 });
    f.renderer.setSelectedRelation(triad.id);
    assert.equal(f.renderer.selectedRelationId, triad.id);
    assert.deepEqual(f.renderer.pendingData.semantic.relations.find(relation => relation.id === triad.id).members, triad.members);
  });
});

function spatialSource() {
  const data = fixtureData();
  const links = [
    { source: "Alice.md", target: "Bob.md", type: "solid", curvature: 0 },
    { source: "Alice.md", target: "Bob.md", type: "dashed", curvature: 0 },
    { source: "Alice.md", target: "Bob.md", type: "dotted", curvature: 0 },
    { source: "Triad.md", target: "Dan.md", type: "sponsor", curvature: 0 },
  ];
  return { ...data, links, semantic: createSemanticGraph(data.nodes, links, data.semantic.relations, []) };
}

function spatialSettings() {
  return { linkOpacity: 0.4, linkThickness: 1.8, showArrows: false,
    linkTypes: {
      solid: createLinkTypeConfig("#f28c28", { lineStyle: "solid", widthMultiplier: 1, opacity: 1, arrowMode: "inherit" }),
      dashed: createLinkTypeConfig("#f28c28", { lineStyle: "dashed", widthMultiplier: 2, opacity: 0.5, arrowMode: "on" }),
      dotted: createLinkTypeConfig("#f28c28", { lineStyle: "dotted", widthMultiplier: 3, opacity: 0.25, arrowMode: "off" }),
      alliance: createLinkTypeConfig("#00bcd4", { lineStyle: "dotted", opacity: 0.8, arrowMode: "on", attraction: 0.6, distanceMultiplier: 1.2 }),
      council: createLinkTypeConfig("#d28cff", { attraction: 0.7, distanceMultiplier: 1.1 }),
    },
  };
}

function spatialObjects(f, link) {
  const spatial = f.renderer.spatialLinks.get(link);
  assert.ok(spatial instanceof SpatialLink3D);
  assert.strictEqual(link.__lineObj, spatial.group, "The engine uses one owned custom object for the connection");
  const path = spatial.group.getObjectByName("gps-spatial-link-path");
  const arrow = spatial.group.getObjectByName("gps-spatial-link-arrow");
  assert.ok(path.isLine2, "The path uses the installed Three world-unit line renderer");
  assert.ok(arrow instanceof THREE.Mesh);
  assert.deepEqual(spatial.group.children, [path, arrow], "No duplicate stock cylinder or arrow is added");
  return { spatial, path, arrow };
}

function sampledPoint(attribute, index) {
  return new THREE.Vector3(attribute.getX(index), attribute.getY(index), attribute.getZ(index));
}

function effectivelyVisible(object) {
  for (let current = object; current; current = current.parent) if (!current.visible) return false;
  return true;
}

function ownedResources(group) {
  const resources = [];
  group.traverse(object => {
    if (object.geometry) resources.push(object.geometry);
    if (object.material) resources.push(...(Array.isArray(object.material) ? object.material : [object.material]));
  });
  assert.equal(resources.length, 4, "Each connection owns one path and one arrow geometry/material");
  assert.equal(new Set(resources).size, 4);
  return resources;
}

test("real 3D engine renders world-unit solid, dashed and round dotted spatial paths for straight and parallel curves", async () => {
  await fixture(async f => {
    await f.apply(projectGraphData(spatialSource(), true));
    const data = f.engine.graphData();
    const ordinary = data.links.filter(link => ["solid", "dashed", "dotted"].includes(link.type));
    assert.equal(ordinary.length, 3);
    const samples = [];
    for (const link of ordinary) {
      const { spatial, path, arrow } = spatialObjects(f, link);
      const config = f.settings.linkTypes[link.type];
      assert.equal(path.material.worldUnits, true);
      assert.equal(path.material.linewidth, f.settings.linkThickness * config.widthMultiplier);
      assert.equal(path.material.dashed, config.lineStyle !== "solid");
      assert.equal(path.material.uniforms.gpsDotted.value, config.lineStyle === "dotted" ? 1 : 0);
      assert.ok(path.material.dashSize > 0 && path.material.gapSize > 0);
      assert.match(path.material.fragmentShader, /gpsLongitudinal.*gpsLongitudinal/,
        "Dotted output clips radial and longitudinal distance into round spatial marks");
      assert.equal(path.material.opacity, f.settings.linkOpacity * config.opacity);
      assert.equal(arrow.material.opacity, path.material.opacity);
      assert.equal(path.material.depthWrite, false);
      assert.ok(!link.__arrowObj, "The stock force-graph arrow is disabled");
      assert.deepEqual(spatial.group.position.toArray(), [0, 0, 0]);
      assert.deepEqual(spatial.group.scale.toArray(), [1, 1, 1]);
      const starts = path.geometry.getAttribute("instanceStart");
      const ends = path.geometry.getAttribute("instanceEnd");
      const distanceStarts = path.geometry.getAttribute("instanceDistanceStart");
      const distanceEnds = path.geometry.getAttribute("instanceDistanceEnd");
      assert.ok(starts.count > 2, "Curve sampling belongs to actual spatial geometry");
      const from = new THREE.Vector3(link.source.x, link.source.y, link.source.z);
      const to = new THREE.Vector3(link.target.x, link.target.y, link.target.z);
      assert.ok(sampledPoint(starts, 0).distanceTo(from) < 1e-3);
      assert.ok(sampledPoint(ends, ends.count - 1).distanceTo(to) < 1e-3);
      const middleIndex = Math.floor(starts.count / 2);
      const middle = sampledPoint(starts, middleIndex);
      const expected = link.__curve ? link.__curve.getPoint(middleIndex / starts.count)
        : from.clone().lerp(to, middleIndex / starts.count);
      assert.ok(middle.distanceTo(expected) < 1e-3, "Custom path follows the real engine's 3D curve");
      assert.equal(!!link.__curve, link.curvature !== 0);
      let measuredLength = 0;
      for (let index = 0; index < starts.count; index++) {
        assert.ok(Math.abs(distanceStarts.getX(index) - measuredLength) < 1e-3);
        measuredLength += sampledPoint(starts, index).distanceTo(sampledPoint(ends, index));
        assert.ok(Math.abs(distanceEnds.getX(index) - measuredLength) < 1e-3);
      }
      if (link.__curve) assert.ok(measuredLength > from.distanceTo(to) + 0.01);
      else assert.ok(Math.abs(measuredLength - from.distanceTo(to)) < 1e-3);
      samples.push(middle);
    }
    assert.ok(samples[0].distanceTo(samples[1]) > 0.1);
    assert.ok(samples[1].distanceTo(samples[2]) > 0.1, "Parallel semantic links have distinct spatial paths");
    const { path: first } = spatialObjects(f, ordinary[0]);
    const { path: second } = spatialObjects(f, ordinary[1]);
    assert.notStrictEqual(first.material, second.material, "Same-color types retain independent opacity and style");
  }, spatialSettings());
});

test("3D global-times-type opacity and inherit/on/off arrows preserve authored semantics, springs and quiet scene state", async () => {
  await fixture(async f => {
    const source = spatialSource();
    const authoredJSON = JSON.stringify(source.semantic);
    await f.apply(projectGraphData(source, true));
    const data = f.engine.graphData();
    const links = [...data.links], nodes = [...data.nodes];
    data.nodes.forEach((node, index) => {
      node.vx = index * 0.02; node.vy = -index * 0.03; node.vz = index * 0.04;
    });
    const pinned = data.nodes.find(node => node.id === "Bob.md");
    pinned.fx = pinned.x; pinned.fy = pinned.y; pinned.fz = pinned.z;
    const state = stateOf(nodes), camera = cameraOf(f), replacements = f.replacements(), reheats = f.reheats();
    const objects = links.map(link => spatialObjects(f, link));
    const force = f.engine.d3Force("link"), forceLinks = force.links();
    const springValues = links.map(link => [force.strength()(link), force.distance()(link)]);
    for (const link of links) {
      const { arrow } = spatialObjects(f, link);
      assert.equal(effectivelyVisible(arrow), link.type === "dashed", "Global off suppresses inheritance; explicit on remains ordinary only");
    }
    f.settings.showArrows = true;
    await f.visual();
    assert.equal(effectivelyVisible(spatialObjects(f, links.find(link => link.type === "solid")).arrow), true);
    assert.equal(effectivelyVisible(spatialObjects(f, links.find(link => link.type === "dotted")).arrow), false);
    assert.ok(links.filter(link => link.kind === "membership").every(link => !effectivelyVisible(spatialObjects(f, link).arrow)));
    f.settings.linkTypes.dashed.opacity = 0;
    f.settings.linkTypes.dotted.opacity = 0.75;
    f.settings.linkTypes.dotted.lineStyle = "dashed";
    f.settings.linkTypes.dotted.widthMultiplier = 2.5;
    await f.visual();
    const hidden = spatialObjects(f, links.find(link => link.type === "dashed"));
    assert.equal(effectivelyVisible(hidden.path), false);
    assert.equal(effectivelyVisible(hidden.arrow), false);
    assert.equal(hidden.path.material.opacity, 0);
    assert.equal(hidden.arrow.material.opacity, 0);
    const solid = spatialObjects(f, links.find(link => link.type === "solid"));
    assert.equal(solid.path.material.opacity, 0.4, "Changing a same-color type cannot leak material opacity");
    const changed = spatialObjects(f, links.find(link => link.type === "dotted"));
    assert.equal(changed.path.material.opacity, 0.4 * 0.75);
    assert.equal(changed.path.material.linewidth, 1.8 * 2.5);
    assert.equal(changed.path.material.uniforms.gpsDotted.value, 0);
    f.settings.linkOpacity = 0;
    await f.visual();
    for (const link of links) {
      const { path, arrow } = spatialObjects(f, link);
      assert.equal(effectivelyVisible(path), false);
      assert.equal(effectivelyVisible(arrow), false);
      assert.equal(path.material.opacity, 0);
      assert.equal(arrow.material.opacity, 0);
    }
    assert.strictEqual(f.engine.graphData(), data);
    nodes.forEach((node, index) => assert.strictEqual(data.nodes[index], node));
    links.forEach((link, index) => {
      assert.strictEqual(data.links[index], link);
      assert.strictEqual(spatialObjects(f, link).spatial, objects[index].spatial);
    });
    assert.strictEqual(force.links(), forceLinks);
    assert.deepEqual(links.map(link => [force.strength()(link), force.distance()(link)]), springValues);
    assert.deepEqual(stateOf(data.nodes), state);
    assert.deepEqual(cameraOf(f), camera);
    assert.equal(f.replacements(), replacements);
    assert.equal(f.reheats(), reheats);
    assert.equal(JSON.stringify(source.semantic), authoredJSON);
    assert.deepEqual(f.renderer.getRelationDisplayCount(triad.id), { displayed: 3, total: 3 });
    assert.equal(links.find(link => link.relationId === triad.id).memberCount, 3);
  }, spatialSettings());
});

test("spatial helper reuses buffers, rejects hidden pointer targets, keeps zero-length arrows hidden, and disposes once", () => {
  const appearance = { color: "#ff9900", width: 3, style: "dashed", opacity: 0.3,
    showArrow: true, arrowLength: 12, targetRadius: 5 };
  const spatial = new SpatialLink3D(appearance);
  const path = spatial.group.getObjectByName("gps-spatial-link-path");
  const arrow = spatial.group.getObjectByName("gps-spatial-link-arrow");
  const resources = ownedResources(spatial.group);
  const disposals = new Map(resources.map(resource => [resource, 0]));
  resources.forEach(resource => resource.addEventListener("dispose", () => disposals.set(resource, disposals.get(resource) + 1)));
  const attributes = ["instanceStart", "instanceEnd", "instanceDistanceStart", "instanceDistanceEnd"]
    .map(name => [name, path.geometry.getAttribute(name), path.geometry.getAttribute(name).data.array]);
  const dottedUniform = path.material.uniforms.gpsDotted;
  const start = new THREE.Vector3(10, -15, 20), end = new THREE.Vector3(140, 45, 170);
  const curve = new THREE.QuadraticBezierCurve3(start, new THREE.Vector3(70, 110, -25), end);
  path.geometry.setPositions = () => { throw new Error("A position update reallocated path attributes"); };
  path.computeLineDistances = () => { throw new Error("A position update allocated dash distances"); };
  try {
    spatial.updatePosition(start, end, {});
    arrow.updateMatrix();
    const tip = new THREE.Vector3(0, 1, 0).applyMatrix4(arrow.matrix);
    const expectedTip = end.clone().addScaledVector(start.clone().sub(end).normalize(), appearance.targetRadius);
    assert.ok(tip.distanceTo(expectedTip) < 1e-8, "The owned cone follows a real 3D direction and stops at the target radius");
    spatial.group.updateMatrixWorld(true);
    const pathNormal = end.clone().sub(start).cross(new THREE.Vector3(0, 1, 0)).normalize();
    const pathRay = new THREE.Raycaster(start.clone().lerp(end, 0.5).addScaledVector(pathNormal, 20), pathNormal.clone().negate());
    const arrowCenter = new THREE.Vector3(0, 0.5, 0).applyMatrix4(arrow.matrixWorld);
    const arrowNormal = new THREE.Vector3(1, 0, 0).transformDirection(arrow.matrixWorld);
    const arrowRay = new THREE.Raycaster(arrowCenter.clone().addScaledVector(arrowNormal, arrow.scale.x * 2), arrowNormal.clone().negate());
    assert.ok(pathRay.intersectObject(path).length > 0, "A visible world-unit path remains pointer-accessible");
    assert.ok(arrowRay.intersectObject(arrow).length > 0, "The real cone geometry provides a valid visible-arrow hit");
    spatial.updateAppearance({ ...appearance, opacity: 0 });
    assert.equal(pathRay.intersectObject(spatial.group, true).length, 0, "Zero opacity rejects path hits even though Three traverses invisible groups");
    assert.equal(arrowRay.intersectObject(spatial.group, true).length, 0, "Zero opacity rejects arrow hits and ghost relationship tooltips");
    spatial.updateAppearance({ ...appearance, showArrow: false });
    assert.equal(arrowRay.intersectObject(arrow).length, 0, "An off arrow is not a pointer target");
    assert.ok(pathRay.intersectObject(path).length > 0, "Disabling arrows preserves the visible connection's pointer target");
    spatial.updateAppearance(appearance);
    spatial.group.updateMatrixWorld(true);
    assert.ok(arrowRay.intersectObject(arrow).length > 0, "Re-enabling arrows restores real cone hits");
    for (const style of ["solid", "dashed", "dotted"]) {
      spatial.updateAppearance({ ...appearance, style, width: 4, opacity: 0.6 });
      for (let index = 0; index < 4; index++) {
        curve.v1.z += 7;
        spatial.updatePosition(start, end, { __curve: curve });
        for (const [name, attribute, array] of attributes) {
          assert.strictEqual(path.geometry.getAttribute(name), attribute);
          assert.strictEqual(path.geometry.getAttribute(name).data.array, array);
        }
        assert.strictEqual(path.material.uniforms.gpsDotted, dottedUniform);
        assert.equal(path.material.linewidth, 4);
        assert.equal(path.material.dashed, style !== "solid");
        assert.equal(dottedUniform.value, style === "dotted" ? 1 : 0);
        assert.ok(effectivelyVisible(path));
        assert.ok(effectivelyVisible(arrow));
        assert.ok(arrow.position.toArray().every(Number.isFinite));
        assert.deepEqual(ownedResources(spatial.group), resources);
      }
    }
    const positionVersion = attributes[0][1].data.version;
    const distanceVersion = attributes[2][1].data.version;
    spatial.updatePosition(start, end, { __curve: new THREE.QuadraticBezierCurve3(curve.v0.clone(), curve.v1.clone(), curve.v2.clone()) });
    assert.equal(attributes[0][1].data.version, positionVersion, "Equivalent force-graph curves do not upload unchanged positions");
    assert.equal(attributes[2][1].data.version, distanceVersion, "A quiet path does not rebuild dash distances");
    spatial.updatePosition(start, start, {});
    assert.equal(effectivelyVisible(path), false);
    assert.equal(effectivelyVisible(arrow), false);
    assert.ok(attributes[0][2].every(Number.isFinite), "Coincident endpoints cannot put NaN in spatial buffers");
    assert.ok(attributes[2][2].every(value => value === 0));
  } finally {
    spatial.dispose(); spatial.dispose();
  }
  assert.deepEqual([...disposals.values()], [1, 1, 1, 1]);
  assert.equal(spatial.group.children.length, 0);
});

test("3D topology replacement and renderer teardown each dispose owned path and arrow resources exactly once", async () => {
  await fixture(async f => {
    const projected = projectGraphData(spatialSource(), true);
    await f.apply(projected);
    const old = [...f.renderer.spatialLinks.values()];
    const resources = old.flatMap(spatial => ownedResources(spatial.group));
    const disposals = new Map(resources.map(resource => [resource, 0]));
    resources.forEach(resource => resource.addEventListener("dispose", () => disposals.set(resource, disposals.get(resource) + 1)));
    await f.apply({ ...projected, links: [] });
    assert.equal(f.renderer.spatialLinks.size, 0);
    assert.ok(old.every(spatial => spatial.group.children.length === 0));
    assert.ok([...disposals.values()].every(count => count === 1), "The engine's subsequent digest cannot dispose owned children twice");
    await f.apply(projected);
    const restoredResources = [...f.renderer.spatialLinks.values()].flatMap(spatial => ownedResources(spatial.group));
    const teardown = new Map(restoredResources.map(resource => [resource, 0]));
    restoredResources.forEach(resource => resource.addEventListener("dispose", () => teardown.set(resource, teardown.get(resource) + 1)));
    // Scene-host destruction is outside this headless harness; production-owned
    // link resources still pass through the real renderer's destroy method.
    f.renderer.graph._destructor = () => {};
    f.renderer.graph.pauseAnimation = () => {};
    f.renderer.destroy();
    f.renderer.destroy();
    assert.equal(f.renderer.spatialLinks.size, 0);
    assert.ok([...teardown.values()].every(count => count === 1));
  }, spatialSettings());
});

test("3D semantic junctions use distinct labelled Three objects and real warmup produces noncoplanar tetra members", async (t) => {
  await fixture(async f => {
    const source = fixtureData();
    const sourceJSON = JSON.stringify(source.semantic);
    await f.apply(projectGraphData(source, true));
    const { nodes, links } = f.engine.graphData();
    assert.equal(nodes.length, 7);
    assert.equal(nodes.filter(node => node.id === "Carol.md").length, 1, "The shared participant stays one node");
    const junctions = nodes.filter(node => node.relation);
    assert.deepEqual(junctions.map(node => node.relation.id).sort(), [triad.id, liaison.id, tetra.id].sort());
    assert.equal(new Set(junctions.map(node => node.__threeObj)).size, 3);
    for (const node of junctions) {
      assert.ok(node.__threeObj instanceof THREE.Group);
      const body = node.__threeObj.getObjectByName("gps-junction-body");
      const label = node.__threeObj.getObjectByName("gps-junction-label");
      assert.ok(body instanceof THREE.Mesh);
      assert.equal(body.geometry.type, "OctahedronGeometry");
      assert.ok(label instanceof THREE.Sprite);
      assert.ok(label.userData.text.includes(`[${node.relation.id}]`));
      assert.equal(label.material.depthTest, false);
      assert.equal(node.__threeObj.userData.totalMemberCount, node.relation.members.length);
      assert.ok(!nodes.some(other => other.id === node.relation.sourcePath), "No duplicate ordinary source-note node");
    }
    assert.equal(links.filter(link => link.kind === "membership").length, 9);
    const ordinary = links.filter(link => link.kind !== "membership");
    assert.equal(ordinary.length, 2);
    assert.ok(ordinary.some(link => link.source.id === "Alice.md" && link.target.id === "Bob.md" && link.type === "trusts"));
    const participants = tetra.members.map(id => nodes.find(node => node.id === id));
    const [a, b, c, d] = participants.map(node => new THREE.Vector3(node.x, node.y, node.z));
    assert.ok(participants.every(node => [node.x, node.y, node.z].every(Number.isFinite)));
    const determinant = b.clone().sub(a).dot(c.clone().sub(a).cross(d.clone().sub(a)));
    const diameter = Math.max(...participants.flatMap((_, i) => participants.slice(i + 1).map((__, j) =>
      [a, b, c, d][i].distanceTo([a, b, c, d][i + j + 1]))));
    const normalizedVolume = Math.abs(determinant) / Math.max(1, diameter ** 3);
    t.diagnostic(`Real 3D warmup: tetra determinant=${determinant}; normalized absolute determinant=${normalizedVolume}`);
    assert.ok(normalizedVolume > 1e-6, "Actual force-generated participant positions must be genuinely noncoplanar");
    assert.equal(JSON.stringify(source.semantic), sourceJSON, "Mutable xyz and Three objects do not enter the immutable semantic model");
  });
});

test("layout-only pause stops real engine ticks while real camera controls keep navigating", async () => {
  await fixture(async f => {
    await f.apply(projectGraphData(fixtureData(), true));
    f.renderer.setAnimate(false);
    assert.equal(f.engine.cooldownTicks(), 0);
    assert.equal(f.engine.warmupTicks(), 0);
    const paused = stateOf(f.engine.graphData().nodes);
    let ticks = 0; f.engine.onEngineTick(() => ticks++);
    // Visual digests and drag resets restart the engine countdown in the
    // installed dependency. A zero cooldown must still prevent any d3 tick.
    f.engine.resetCountdown();
    for (let i = 0; i < 5; i++) f.engine.tickFrame();
    assert.equal(ticks, 0);
    assert.deepEqual(stateOf(f.engine.graphData().nodes), paused);
    const before = f.camera.position.clone();
    const wheel = new Event("wheel", { cancelable: true });
    Object.assign(wheel, { deltaMode: 0, deltaY: 120 });
    f.canvas.dispatchEvent(wheel); f.controls.update();
    assert.ok(f.camera.position.distanceTo(before) > 0.1, "Real TrackballControls zoom while layout is paused");
    assert.deepEqual(stateOf(f.engine.graphData().nodes), paused);
    f.renderer.setAnimate(true); await digest();
    assert.equal(f.engine.cooldownTicks(), Infinity);
    f.engine.tickFrame();
    assert.ok(ticks > 0, "Resuming layout permits real physics ticks");
    f.renderer.setAnimate(false);
  });
});

test("3D appearance and relation selection preserve quiet xyz, velocities, pins, data references, and camera", async () => {
  await fixture(async f => {
    await f.apply(projectGraphData(fixtureData(), true));
    const data = f.engine.graphData();
    data.nodes.forEach((node, i) => {
      node.vx = i * 0.01; node.vy = -i * 0.02; node.vz = i * 0.03;
    });
    const bob = data.nodes.find(node => node.id === "Bob.md");
    bob.fx = bob.x; bob.fy = bob.y; bob.fz = bob.z;
    const states = stateOf(data.nodes), camera = cameraOf(f), replacements = f.replacements(), reheats = f.reheats();
    const references = [...data.nodes];
    f.settings.linkTypes.alliance.color = "#e654ab";
    f.settings.linkTypes.alliance.widthMultiplier = 2;
    f.settings.nodeOpacity3D = 0.7;
    await f.visual();
    f.renderer.setSelectedRelation(triad.id);
    f.engine.tickFrame();
    for (const node of data.nodes) {
      const shell = node.__threeObj.getObjectByName("gps-semantic-selection");
      const member = triad.members.includes(node.id);
      assert.equal(!!shell, member || node.relation?.id === triad.id,
        `${node.id}: only the selected junction and authored displayed members are highlighted`);
      if (shell) {
        assert.equal(shell.userData.directMember, member);
        assert.equal(shell.userData.relationId, triad.id);
        assert.ok(shell instanceof THREE.Mesh);
        const hits = []; shell.raycast(new THREE.Raycaster(), hits);
        assert.equal(hits.length, 0, "Selection shells do not enlarge interaction targets");
      }
    }
    assert.strictEqual(f.engine.graphData(), data);
    assert.deepEqual(f.engine.graphData().nodes, references);
    assert.equal(f.replacements(), replacements);
    assert.equal(f.reheats(), reheats);
    assert.deepEqual(stateOf(data.nodes), states);
    assert.deepEqual(cameraOf(f), camera);
    assert.deepEqual(f.renderer.getDisplayedMemberIds(triad).sort(), ["Alice.md", "Bob.md", "Carol.md"]);
    const junction = data.nodes.find(node => node.relation?.id === triad.id);
    assert.equal(junction.__threeObj.getObjectByName("gps-junction-body").material.color.getHexString(), "e654ab");
    f.renderer.setSelectedRelation(liaison.id);
    assert.deepEqual(f.renderer.getDisplayedMemberIds(liaison).sort(), ["Carol.md", "Dan.md"]);
    f.renderer.setSelectedRelation(null);
    assert.deepEqual(stateOf(data.nodes), states);
    assert.deepEqual(cameraOf(f), camera);
    assert.equal(f.reheats(), reheats);
  });
});

test("3D filtering retains full authored counts and original spring normalization, including direct nested members", async () => {
  const nested = authored("nested", "Nested", "alliance", ["Triad", "Dan"]);
  await fixture(async f => {
    const projected = projectGraphData(fixtureData([nested]), true);
    const visible = new Set(projected.nodes.filter(node => node.id !== "Carol.md").map(node => node.id));
    const partial = { ...projected, nodes: projected.nodes.filter(node => visible.has(node.id)),
      links: projected.links.filter(link => visible.has(link.source) && visible.has(link.target)) };
    await f.apply(partial);
    assert.deepEqual(f.renderer.getRelationDisplayCount(triad.id), { displayed: 2, total: 3 });
    assert.deepEqual(f.renderer.getRelationDisplayCount(liaison.id), { displayed: 1, total: 2 });
    assert.deepEqual(f.renderer.getRelationDisplayCount(tetra.id), { displayed: 3, total: 4 });
    assert.deepEqual(f.renderer.getDisplayedMemberIds(nested).sort(), ["Dan.md", relationJunctionId(triad.id)].sort(), "Nested membership is direct; it does not flatten Triad into Alice/Bob/Carol");
    const nodes = f.engine.graphData().nodes;
    f.renderer.setSelectedRelation(nested.id);
    const direct = nodes.filter(node => node.__threeObj.getObjectByName("gps-semantic-selection")?.userData.directMember)
      .map(node => node.id).sort();
    assert.deepEqual(direct, ["Dan.md", relationJunctionId(triad.id)].sort());
    const junction = nodes.find(node => node.relation?.id === triad.id);
    assert.ok(junction.__threeObj.getObjectByName("gps-junction-label").userData.text.includes("2/3 shown (partial)"));
    const link = f.engine.graphData().links.find(link => link.relationId === triad.id);
    const linkForce = f.engine.d3Force("link");
    assert.equal(link.memberCount, 3);
    assert.equal(linkForce.strength()(link), 0.6 / 3);
    assert.equal(linkForce.distance()(link), f.settings.linkDistance * 1.2);
    const onlyJunction = { ...partial, nodes: partial.nodes.filter(node => node.relation?.id === triad.id), links: [] };
    await f.apply(onlyJunction);
    assert.deepEqual(f.renderer.getRelationDisplayCount(triad.id), { displayed: 0, total: 3 });
    const remaining = f.engine.graphData().nodes[0];
    assert.ok(remaining.__threeObj.getObjectByName("gps-junction-label").userData.text.includes("0/3 shown (partial)"));
    assert.equal(remaining.relation.members.length, 3);
  });
});

test("paused 3D metadata and projection changes reuse surviving nodes and their layout, including source-junction mapping", async () => {
  await fixture(async f => {
    const source = fixtureData();
    await f.apply(projectGraphData(source, true));
    const initial = f.engine.graphData();
    const nodes = [...initial.nodes];
    const triadNode = nodes.find(node => node.relation?.id === triad.id);
    triadNode.fx = triadNode.x; triadNode.fy = triadNode.y; triadNode.fz = triadNode.z;
    const positions = stateOf(nodes), camera = cameraOf(f), replacements = f.replacements();
    await f.apply(projectGraphData(source, true));
    assert.equal(f.replacements(), replacements, "An equivalent metadata refresh does not replace topology");
    nodes.forEach((node, i) => assert.strictEqual(f.engine.graphData().nodes[i], node));
    assert.deepEqual(stateOf(f.engine.graphData().nodes), positions);
    await f.apply(projectGraphData(source, false));
    const standard = f.engine.graphData();
    const sourceNote = standard.nodes.find(node => node.id === "Triad.md");
    assert.ok(sourceNote.__threeObj instanceof THREE.Mesh, "Standard mode replaces the custom junction with an ordinary entity object");
    assert.equal(sourceNote.__threeObj.geometry.type, "SphereGeometry");
    assert.deepEqual([sourceNote.x, sourceNote.y, sourceNote.z, sourceNote.fx, sourceNote.fy, sourceNote.fz],
      [triadNode.x, triadNode.y, triadNode.z, triadNode.fx, triadNode.fy, triadNode.fz]);
    assert.ok(standard.nodes.every(node => !node.relation));
    assert.equal(standard.links.filter(link => link.kind === "membership").length, 9, "Standard graph preserves authored note connections");
    for (const node of nodes.filter(node => !node.relation)) {
      assert.strictEqual(standard.nodes.find(other => other.id === node.id), node);
    }
    assert.deepEqual(cameraOf(f), camera);
    await f.apply(projectGraphData(source, true));
    const restored = f.engine.graphData().nodes.find(node => node.relation?.id === triad.id);
    assert.ok(restored.__threeObj instanceof THREE.Group, "Returning to junction mode restores a distinct relationship object");
    assert.equal(restored.__threeObj.getObjectByName("gps-junction-body").geometry.type, "OctahedronGeometry");
    assert.deepEqual([restored.x, restored.y, restored.z, restored.fx, restored.fy, restored.fz],
      [sourceNote.x, sourceNote.y, sourceNote.z, sourceNote.fx, sourceNote.fy, sourceNote.fz]);
    assert.deepEqual(cameraOf(f), camera);
  });
});

test("3D junction activation exposes full immutable membership and uses source-note actions; incidence ignores arrows and direction rules", async () => {
  await fixture(async f => {
    await f.apply(projectGraphData(fixtureData(), true));
    const junction = f.engine.graphData().nodes.find(node => node.relation?.id === triad.id);
    f.renderer.selectNode(junction);
    assert.equal(f.selected.at(-1).id, triad.id);
    assert.deepEqual(f.selected.at(-1).members, triad.members);
    assert.ok(Object.isFrozen(f.selected.at(-1)));
    assert.equal(f.opened.length, 0);
    f.renderer.selectNode(junction, true);
    assert.deepEqual(f.opened.at(-1), [triad.sourcePath, "", "tab"]);
    f.renderer.onSelectRelation = undefined;
    f.renderer.selectNode(junction);
    assert.deepEqual(f.opened.at(-1), [triad.sourcePath, "", false]);
    const alice = f.engine.graphData().nodes.find(node => node.id === "Alice.md");
    f.renderer.selectNode(alice);
    assert.deepEqual(f.opened.at(-1), ["Alice.md", "", false]);
    f.settings.linkTypes.alliance.arrowMode = "on";
    f.settings.linkTypes.alliance.attraction = 3;
    f.settings.linkStrength = 2;
    f.settings.linkTypes.alliance.forceRule = "distance:1.5x forward:2";
    f.renderer.rebuildForceRuleCache();
    const incidence = { type: "alliance", kind: "membership", memberCount: 3, source: junction, target: alice };
    assert.equal(f.renderer.shouldShowArrow(incidence), false);
    assert.equal(f.renderer.getLinkStrength(incidence), 2 / 3);
    assert.ok(Math.abs(f.renderer.getLinkDistance(incidence) - f.settings.linkDistance * 1.2 * 1.5) < 1e-9);
    assert.equal(f.renderer.shouldShowArrow({ type: "trusts" }), true);
    const before = [junction.vx, junction.vy, junction.vz, alice.vx, alice.vy, alice.vz];
    const realLinkForce = f.engine.d3Force("link");
    const oldLinks = realLinkForce.links(); realLinkForce.links([incidence]);
    f.renderer.createLinkTypeForce()(1);
    assert.deepEqual([junction.vx, junction.vy, junction.vz, alice.vx, alice.vy, alice.vz], before,
      "Directional force rules must not invent directed incidence behavior");
    realLinkForce.links(oldLinks);
  });
});

function enclosureFaces(geometry, matrix) {
  assert.ok(geometry instanceof THREE.BufferGeometry);
  const position = geometry.getAttribute("position");
  assert.ok(position.count >= 12 && position.count % 3 === 0);
  assert.ok(position.array.every(Number.isFinite));
  const vertices = Array.from({ length: position.count }, (_, index) => {
    const point = sampledPoint(position, index);
    return matrix ? point.applyMatrix4(matrix) : point;
  });
  const center = vertices.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / vertices.length);
  const count = geometry.index?.count ?? position.count;
  let volume = 0;
  const faces = [];
  for (let index = 0; index < count; index += 3) {
    const points = [0, 1, 2].map(offset => vertices[geometry.index ? geometry.index.getX(index + offset) : index + offset]);
    const [a, b, c] = points;
    const normal = b.clone().sub(a).cross(c.clone().sub(a));
    assert.ok(normal.length() > 1e-7, "Padded participant solids produce usable spatial hull triangles");
    volume += Math.abs(a.clone().sub(center).dot(b.clone().sub(center).cross(c.clone().sub(center)))) / 6;
    normal.normalize();
    if (normal.dot(center.clone().sub(a)) > 0) normal.negate();
    faces.push({ normal, point: a });
  }
  assert.ok(Number.isFinite(volume) && volume > 1e-3, "An enclosure has actual xyz volume, including degenerate participant layouts");
  return { faces, volume, center };
}

function assertEncloses(geometry, members, padding = 12, matrix) {
  const { faces, volume } = enclosureFaces(geometry, matrix);
  for (const member of members) {
    const center = new THREE.Vector3(member.x, member.y, member.z);
    const radius = Math.max(0, member.radius ?? 0) + padding;
    for (const face of faces) {
      const distance = face.normal.dot(center.clone().sub(face.point));
      assert.ok(distance <= -radius + 1e-3,
        `${member.id}: every hull face contains the full participant solid plus padding (distance=${distance}, radius=${radius})`);
    }
  }
  return volume;
}

function enclosureObject(f, relationId) {
  const enclosure = f.renderer.spatialEnclosures.get(relationId);
  assert.ok(enclosure instanceof SpatialEnclosure3D);
  assert.equal(enclosure.group.name, "gps-spatial-enclosure");
  assert.strictEqual(enclosure.group.parent, f.renderer.graph.scene());
  const shell = enclosure.group.getObjectByName("gps-spatial-enclosure-shell");
  assert.ok(shell instanceof THREE.Mesh);
  enclosure.group.updateMatrixWorld(true);
  return { enclosure, shell };
}

function displayedSolids(f, relation) {
  const nodes = f.engine.graphData().nodes;
  return f.renderer.getDisplayedMemberIds(relation).map(id => {
    const node = nodes.find(node => node.id === id);
    return { id, x: node.x, y: node.y, z: node.z,
      radius: Math.cbrt(f.renderer.getNodeVal(node)) * f.settings.nodeRelSize3D * (node.relation ? 1.25 : 1) };
  });
}

test("padded Three convex enclosures retain volume and contain full participant solids for spatial, planar, collinear, coincident and sparse layouts", () => {
  const point = (id, x, y, z, radius = 4) => Object.freeze({ id, x, y, z, radius });
  const cases = [
    [point("a", 0, 0, 0, 2), point("b", 70, 0, 0, 5), point("c", 0, 80, 0, 3), point("d", 0, 0, 90, 8)],
    [point("a", -40, -25, 13), point("b", 65, -15, 13), point("c", 10, 75, 13, 10)],
    [point("a", -40, -80, -120), point("b", 0, 0, 0, 12), point("c", 40, 80, 120)],
    [point("a", 20, -15, 30, 2), point("b", 20, -15, 30, 16)],
    [point("a", -50, 20, 70), point("b", 80, 75, -30)],
    [point("a", 3, -7, 9, 0)],
  ];
  for (const members of cases) {
    const frozen = Object.freeze(members);
    const before = structuredClone(frozen);
    const geometry = buildSpatialEnclosureGeometry(frozen);
    try { assertEncloses(geometry, frozen); }
    finally { geometry?.dispose(); }
    assert.deepEqual(frozen, before, "Hull construction cannot mutate authored participants or their render positions");
  }
  assert.equal(buildSpatialEnclosureGeometry([]), null);
  const invalid = [point("nan", NaN, 0, 0), point("infinity", 0, Infinity, 0), point("missing-z", 0, 0, undefined)];
  assert.equal(buildSpatialEnclosureGeometry(invalid), null, "No finite spatial participants means no invented enclosure");
  const valid = point("valid", 10, 20, 30, 4);
  const mixed = buildSpatialEnclosureGeometry([...invalid, valid]);
  try { assertEncloses(mixed, [valid]); }
  finally { mixed?.dispose(); }
});

test("enclosure helper caches quiet/member-order changes, preserves filtered and drawable counts, rejects pointer hits, and disposes replacements once", () => {
  const members = [
    { id: "a", x: -30, y: 0, z: 20, radius: 4 },
    { id: "b", x: 60, y: 40, z: -25, radius: 7 },
  ];
  const enclosure = new SpatialEnclosure3D("#00bcd4", 0.06);
  assert.equal(enclosure.updateMembers(members, 5), true);
  const shell = enclosure.group.getObjectByName("gps-spatial-enclosure-shell");
  const originalGeometry = shell.geometry, material = shell.material;
  let originalDisposals = 0, materialDisposals = 0, replacementDisposals = 0;
  originalGeometry.addEventListener("dispose", () => originalDisposals++);
  material.addEventListener("dispose", () => materialDisposals++);
  try {
    assertEncloses(originalGeometry, members);
    assert.equal(enclosure.updateMembers([...members].reverse(), 8), false);
    assert.strictEqual(shell.geometry, originalGeometry);
    assert.equal(enclosure.group.userData.authoredMemberCount, 8);
    assert.equal(enclosure.group.userData.geometryMemberCount, 2);
    assert.deepEqual([...enclosure.group.userData.geometryMemberIds].sort(), ["a", "b"]);
    enclosure.updateAppearance("#e654ab", 0.12, true);
    assert.strictEqual(shell.geometry, originalGeometry);
    assert.strictEqual(shell.material, material);
    assert.equal(shell.material.opacity, 0.12);
    assert.equal(shell.material.depthWrite, false);
    enclosure.group.updateMatrixWorld(true);
    originalGeometry.computeBoundingSphere();
    const { center } = enclosureFaces(originalGeometry);
    const ray = new THREE.Raycaster(center.clone().add(new THREE.Vector3(originalGeometry.boundingSphere.radius * 2 + 20, 0, 0)), new THREE.Vector3(-1, 0, 0));
    const rawHits = [];
    THREE.Mesh.prototype.raycast.call(shell, ray, rawHits);
    assert.ok(rawHits.length > 0, "The test ray crosses the actual convex shell geometry");
    assert.equal(ray.intersectObject(enclosure.group, true).length, 0, "A selected enclosure adds no hit surface or ghost pointer target");
    enclosure.updateAppearance("#00bcd4", 0, false);
    assert.equal(ray.intersectObject(enclosure.group, true).length, 0);
    const moved = members.map(member => ({ ...member, z: member.z + 15 }));
    assert.equal(enclosure.updateMembers(moved, 8), true);
    assert.equal(originalDisposals, 1);
    assert.notStrictEqual(shell.geometry, originalGeometry);
    shell.geometry.addEventListener("dispose", () => replacementDisposals++);
    assertEncloses(shell.geometry, moved);
    assert.equal(enclosure.updateMembers([...moved, { id: "unready", x: NaN, y: 0, z: 0, radius: 4 }], 8), false,
      "Unready coordinates alter inspector counts separately from drawable hull geometry");
    assert.equal(enclosure.group.userData.geometryMemberCount, 2);
  } finally {
    enclosure.dispose(); enclosure.dispose();
  }
  assert.equal(originalDisposals, 1);
  assert.equal(replacementDisposals, 1);
  assert.equal(materialDisposals, 1);
  assert.equal(enclosure.group.children.length, 0);
});

test("native 3D enclosures use direct authored IDs, keep overlapping identities separate, and retain partial counts without nested flattening or inferred members", async () => {
  const nested = authored("nested-enclosure", "Nested", "alliance", ["Triad", "Dan"]);
  await fixture(async f => {
    const source = fixtureData([nested]), authoredJSON = JSON.stringify(source.semantic);
    const projected = projectGraphData(source, true);
    await f.apply(projected);
    assert.equal(f.renderer.spatialEnclosures.size, 4);
    const triadObject = enclosureObject(f, triad.id);
    const liaisonObject = enclosureObject(f, liaison.id);
    assert.notStrictEqual(triadObject.enclosure.group, liaisonObject.enclosure.group);
    assert.notStrictEqual(triadObject.shell.geometry, liaisonObject.shell.geometry);
    assert.notStrictEqual(triadObject.shell.material, liaisonObject.shell.material);
    assert.equal(triadObject.shell.material.color.getHexString(), liaisonObject.shell.material.color.getHexString());
    const dan = f.engine.graphData().nodes.find(node => node.id === "Dan.md");
    const triadMembers = displayedSolids(f, triad);
    for (const axis of ["x", "y", "z"]) dan[axis] = triadMembers.reduce((sum, member) => sum + member[axis], 0) / triadMembers.length;
    f.renderer.graph.nodeDrag(dan);
    const { shell } = enclosureObject(f, triad.id);
    assertEncloses(shell.geometry, [{ id: dan.id, x: dan.x, y: dan.y, z: dan.z, radius: 0 }], 0,
      triadObject.enclosure.group.matrixWorld);
    assert.deepEqual(triadObject.enclosure.group.userData.displayedMemberIds.sort(), ["Alice.md", "Bob.md", "Carol.md"]);
    assert.ok(!f.renderer.getDisplayedMemberIds(triad).includes(dan.id), "Geometry containment never authors a membership");
    f.renderer.setSelectedRelation(triad.id);
    assert.ok(!dan.__threeObj.getObjectByName("gps-semantic-selection"));
    const nestedObject = enclosureObject(f, nested.id);
    assert.deepEqual(nestedObject.enclosure.group.userData.displayedMemberIds.sort(), ["Dan.md", relationJunctionId(triad.id)].sort());
    assertEncloses(nestedObject.shell.geometry, displayedSolids(f, nested), 12, nestedObject.enclosure.group.matrixWorld);
    const filter = visible => ({ ...projected, nodes: projected.nodes.filter(node => visible.has(node.id)),
      links: projected.links.filter(link => visible.has(link.source) && visible.has(link.target)) });
    for (const displayed of [2, 1, 0]) {
      const visible = new Set(projected.nodes.filter(node => !triad.members.includes(node.id) || triad.members.slice(0, displayed).includes(node.id)).map(node => node.id));
      await f.apply(filter(visible));
      assert.deepEqual(f.renderer.getRelationDisplayCount(triad.id), { displayed, total: 3 });
      if (displayed) {
        const partial = enclosureObject(f, triad.id);
        assert.equal(partial.enclosure.group.userData.displayedMemberCount, displayed);
        assert.equal(partial.enclosure.group.userData.totalMemberCount, 3);
        assert.equal(partial.enclosure.group.userData.partial, true);
        assertEncloses(partial.shell.geometry, displayedSolids(f, triad), 12, partial.enclosure.group.matrixWorld);
        const incidence = f.engine.graphData().links.find(link => link.relationId === triad.id);
        assert.equal(incidence.memberCount, 3);
        assert.equal(f.engine.d3Force("link").strength()(incidence), 0.6 / 3);
      } else assert.ok(!f.renderer.spatialEnclosures.has(triad.id), "Zero displayed members leaves inspection intact without an enclosure");
    }
    f.settings.linkTypes.alliance.visible = false;
    await f.visual();
    assert.ok(!f.renderer.spatialEnclosures.has(nested.id));
    assert.ok(!f.renderer.spatialEnclosures.has(liaison.id));
    const current = f.engine.graphData();
    const visible = new Set(current.nodes.filter(node => node.relation?.id !== tetra.id).map(node => node.id));
    await f.apply(filter(visible));
    assert.ok(!f.renderer.spatialEnclosures.has(tetra.id), "A filtered source junction leaves no orphan shell");
    assert.deepEqual(f.renderer.getRelationDisplayCount(tetra.id), { displayed: 1, total: 4 });
    assert.equal(JSON.stringify(source.semantic), authoredJSON);
  }, { hyperrelationEnclosures3D: true });
});

test("3D enclosure toggles, independent opacity and selection preserve quiet xyz, velocities, pins, scene data, camera and springs", async () => {
  await fixture(async f => {
    await f.apply(projectGraphData(fixtureData(), true));
    assert.equal(f.renderer.spatialEnclosures.size, 0);
    const data = f.engine.graphData(), nodes = [...data.nodes], links = [...data.links];
    nodes.forEach((node, index) => { node.vx = index * 0.02; node.vy = -index * 0.03; node.vz = index * 0.04; });
    const pinned = nodes.find(node => node.id === "Bob.md");
    pinned.fx = pinned.x; pinned.fy = pinned.y; pinned.fz = pinned.z;
    const state = stateOf(nodes), camera = cameraOf(f), replacements = f.replacements(), reheats = f.reheats();
    const linkForce = f.engine.d3Force("link"), forceLinks = linkForce.links();
    const springs = links.map(link => [linkForce.strength()(link), linkForce.distance()(link)]);
    const spatialLinks = links.map(link => f.renderer.spatialLinks.get(link));
    f.settings.hyperrelationEnclosures3D = true;
    await f.visual();
    const original = [...f.renderer.spatialEnclosures.entries()].map(([id, enclosure]) => [id, enclosure,
      enclosure.group.getObjectByName("gps-spatial-enclosure-shell").geometry]);
    for (const [id] of original) {
      const { enclosure, shell } = enclosureObject(f, id);
      assert.equal(shell.material.opacity, 0.06);
      assertEncloses(shell.geometry, displayedSolids(f, nodes.find(node => node.relation?.id === id).relation), 12, enclosure.group.matrixWorld);
    }
    f.settings.linkOpacity = 0;
    f.settings.linkTypes.alliance.opacity = 0;
    f.settings.enclosureFillOpacity3D = 0.12;
    f.settings.linkTypes.alliance.color = "#e654ab";
    await f.visual();
    assert.equal(enclosureObject(f, triad.id).shell.material.color.getHexString(), "e654ab");
    f.renderer.setSelectedRelation(triad.id);
    f.engine.tickFrame();
    for (const [id, enclosure, geometry] of original) {
      const current = enclosureObject(f, id);
      assert.strictEqual(current.enclosure, enclosure);
      assert.strictEqual(current.shell.geometry, geometry, "Appearance and selection reuse quiet hull geometry");
      assert.equal(current.shell.material.opacity, 0.12, "Enclosure fill remains independent of pairwise link opacity");
      assert.ok(current.enclosure.group.userData.displayedMemberIds.length > 0);
    }
    f.settings.enclosureFillOpacity3D = 0;
    await f.visual();
    assert.ok([...f.renderer.spatialEnclosures.values()].every(enclosure => !enclosure.group.visible));
    f.renderer.setSelectedRelation(null);
    const disposed = [];
    for (const [, enclosure, geometry] of original) {
      let count = 0; geometry.addEventListener("dispose", () => count++);
      disposed.push(() => count);
    }
    f.settings.hyperrelationEnclosures3D = false;
    await f.visual();
    assert.equal(f.renderer.spatialEnclosures.size, 0);
    assert.ok(original.every(([, enclosure]) => enclosure.group.parent === null && enclosure.group.children.length === 0));
    assert.ok(disposed.every(count => count() === 1));
    assert.strictEqual(f.engine.graphData(), data);
    nodes.forEach((node, index) => assert.strictEqual(data.nodes[index], node));
    links.forEach((link, index) => {
      assert.strictEqual(data.links[index], link);
      assert.strictEqual(f.renderer.spatialLinks.get(link), spatialLinks[index]);
    });
    assert.strictEqual(linkForce.links(), forceLinks);
    assert.deepEqual(links.map(link => [linkForce.strength()(link), linkForce.distance()(link)]), springs);
    assert.deepEqual(stateOf(data.nodes), state);
    assert.deepEqual(cameraOf(f), camera);
    assert.equal(f.replacements(), replacements);
    assert.equal(f.reheats(), reheats);
  });
});
