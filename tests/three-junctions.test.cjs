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
const { GraphRenderer3D, DEFAULT_SETTINGS, createLinkTypeConfig, createSemanticGraph,
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
