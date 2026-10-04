const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const esbuild = require("esbuild");

// Exercise committed renderer code with the installed dependencies. Canvas
// recording checks drawing instructions; it is not Obsidian or visual acceptance.
const projectRoot = path.resolve(__dirname, "..");
const result = esbuild.buildSync({
  stdin: {
    contents: [
      'export { GraphRenderer2D } from "./src/graphRenderer2D";',
      'export { GraphRenderer3D } from "./src/graphRenderer3D";',
      'export { DEFAULT_SETTINGS, createLinkTypeConfig } from "./src/types";',
      'export { forceSimulation, forceLink, forceManyBody, forceCollide, forceX, forceY } from "d3-force";',
      'export { forceSimulation as forceSimulation3D, forceLink as forceLink3D, forceManyBody as forceManyBody3D, forceZ } from "d3-force-3d";',
    ].join("\n"),
    resolveDir: projectRoot,
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "es2020",
  write: false,
  logLevel: "silent",
});
const compiled = new Module(path.join(__dirname, "renderers.generated.cjs"), module);
compiled.filename = compiled.id;
compiled.paths = module.paths;
compiled._compile(result.outputFiles[0].text, compiled.filename);
const { GraphRenderer2D, GraphRenderer3D, DEFAULT_SETTINGS, createLinkTypeConfig } = compiled.exports;
const { forceSimulation, forceLink, forceManyBody, forceCollide, forceX, forceY, forceSimulation3D, forceLink3D, forceManyBody3D, forceZ } = compiled.exports;

function settings(linkTypes = {}, overrides = {}) {
  return { ...DEFAULT_SETTINGS, linkTypes, ...overrides };
}

function recordingContext() {
  const draws = [];
  const labels = [];
  let currentPath = [];
  let dash = [];
  const ctx = {
    draws,
    labels,
    lineCap: "butt",
    globalAlpha: 1,
    save() {}, restore() {}, clearRect() {}, translate() {}, scale() {},
    beginPath() { currentPath = []; },
    moveTo(...args) { currentPath.push(["moveTo", ...args]); },
    lineTo(...args) { currentPath.push(["lineTo", ...args]); },
    quadraticCurveTo(...args) { currentPath.push(["quadraticCurveTo", ...args]); },
    arc(...args) { currentPath.push(["arc", ...args]); },
    closePath() { currentPath.push(["closePath"]); },
    setLineDash(value) { dash = [...value]; },
    stroke() { record("stroke"); },
    fill() { record("fill"); },
    strokeText() {},
    fillText(text, x, y) { labels.push({ text, x, y, font: ctx.font, color: ctx.fillStyle }); },
  };
  function record(kind) {
    draws.push({
      kind, path: [...currentPath], dash: [...dash],
      lineCap: ctx.lineCap, lineWidth: ctx.lineWidth,
      alpha: ctx.globalAlpha, color: kind === "stroke" ? ctx.strokeStyle : ctx.fillStyle,
    });
  }
  return ctx;
}

function fixture2D(config, links, nodes, hoveredNode = null) {
  const renderer = Object.create(GraphRenderer2D.prototype);
  Object.assign(renderer, {
    settings: config, links, nodes, hoveredNode,
    ctx: recordingContext(), destroyed: false,
    transform: { x: 0, y: 0, k: 1 }, width: 800, height: 600,
    resolvedBgColor: "#111111", resolvedTextColor: "#ffffff",
    forceRuleCache: new Map(),
  });
  return renderer;
}

const node = (id, x, y) => ({ id, name: id, x, y, exists: true, tags: [], properties: {}, isAttachment: false });

test("2D draws circular dots and curved dashes with independent width, opacity, and solid arrows", () => {
  const a = node("a", 10, 20);
  const b = node("b", 100, 20);
  const renderer = fixture2D(settings({
    dotted: createLinkTypeConfig("#ff0000", { lineStyle: "dotted", widthMultiplier: 2, opacity: 0.4, arrowMode: "on" }),
    dashed: createLinkTypeConfig("#00ff00", { lineStyle: "dashed", widthMultiplier: 1, opacity: 0.7, arrowMode: "off" }),
  }, { showLabels: false, showNodeLabels: false }), [
    { source: a, target: b, type: "dotted", curvature: 0 },
    { source: a, target: b, type: "dashed", curvature: 0.3 },
  ], [a, b]);
  renderer.render();
  const [dots, arrow, dashes, firstNode] = renderer.ctx.draws;
  assert.equal(dots.kind, "stroke");
  assert.deepEqual(dots.dash, [0, 7.5]);
  assert.equal(dots.lineCap, "round");
  assert.equal(dots.lineWidth, 3);
  assert.equal(dots.alpha, 0.4);
  assert.equal(dots.color, "#ff0000");
  assert.equal(arrow.kind, "fill");
  assert.equal(arrow.path.at(-1)[0], "closePath");
  assert.deepEqual(arrow.dash, []);
  assert.equal(arrow.alpha, 0.4);
  assert.equal(arrow.color, "#ff0000");
  assert.equal(dashes.path[1][0], "quadraticCurveTo");
  assert.deepEqual(dashes.dash, [6, 3.75]);
  assert.equal(dashes.lineCap, "butt");
  assert.equal(dashes.alpha, 0.7);
  assert.equal(dashes.color, "#00ff00");
  assert.equal(firstNode.path[0][0], "arc");
  assert.deepEqual(firstNode.dash, []);
  assert.equal(firstNode.lineCap, "butt");
  assert.equal(firstNode.alpha, 1);
});

test("2D hover dimming multiplies configured opacity for edges and arrowheads", () => {
  const a = node("a", 10, 20), b = node("b", 100, 20), c = node("c", 200, 20);
  const renderer = fixture2D(settings({
    relation: createLinkTypeConfig("#ff0000", { opacity: 0.5, arrowMode: "on" }),
  }, { showLabels: false, showNodeLabels: false }), [
    { source: a, target: b, type: "relation", curvature: 0 },
    { source: b, target: c, type: "relation", curvature: 0 },
  ], [a, b, c], a);
  renderer.render();
  assert.deepEqual(renderer.ctx.draws.slice(0, 4).map(draw => draw.alpha), [0.5, 0.5, 0.05, 0.05]);
});

test("2D group edits recolor existing nodes without replacing positions or reheating", () => {
  const a = node("a", 10, 20), b = node("b", 100, 20);
  a.properties = { affiliation: ["imbued"] };
  b.groupColor = "#stale";
  const renderer = fixture2D(settings({}, {
    nodeGroups: [{ query: "[affiliation:imbued]", color: "#ff0000" }],
    showLabels: false, showNodeLabels: false,
  }), [], [a, b]);
  renderer.simulation = forceSimulation(renderer.nodes).alpha(0.02).stop();
  renderer.simulation.restart = () => { throw new Error("Group color edit restarted the layout"); };
  const existingNodes = renderer.nodes;
  const positions = existingNodes.map(({ x, y, vx, vy }) => ({ x, y, vx, vy }));

  renderer.updateNodeGroups();
  assert.strictEqual(renderer.nodes, existingNodes);
  assert.strictEqual(renderer.simulation.nodes(), existingNodes);
  assert.equal(renderer.simulation.alpha(), 0.02);
  assert.deepEqual(existingNodes.map(({ x, y, vx, vy }) => ({ x, y, vx, vy })), positions);
  assert.equal(a.groupColor, "#ff0000");
  assert.equal(b.groupColor, undefined);
  assert.deepEqual(renderer.ctx.draws.filter(draw => draw.kind === "fill").map(draw => draw.color),
    ["#ff0000", renderer.settings.nodeColor]);

  renderer.settings.nodeGroups[0].color = "#00ff00";
  renderer.ctx.draws.length = 0;
  renderer.updateNodeGroups();
  assert.equal(renderer.ctx.draws.find(draw => draw.kind === "fill").color, "#00ff00");
  renderer.settings.nodeGroups = [];
  renderer.updateNodeGroups();
  assert.equal(a.groupColor, undefined);
  assert.equal(renderer.simulation.alpha(), 0.02);
});

test("3D group edits invalidate sphere and missing-node colors without replacing data or reheating", () => {
  // Construct only the renderer shell; this does not claim a WebGL/Obsidian test.
  const previousDocument = global.document;
  const previousResizeObserver = global.ResizeObserver;
  const originalInit = GraphRenderer3D.prototype.initGraph;
  let renderer;
  try {
    global.document = { createElement: () => ({ style: {} }) };
    global.ResizeObserver = class { observe() {} };
    GraphRenderer3D.prototype.initGraph = () => {};
    renderer = new GraphRenderer3D({ appendChild() {} }, {}, settings({}, {
      nodeGroups: [{ query: "[affiliation:imbued]", color: "#ff0000" }],
    }));
  } finally {
    GraphRenderer3D.prototype.initGraph = originalInit;
    if (previousDocument === undefined) delete global.document;
    else global.document = previousDocument;
    if (previousResizeObserver === undefined) delete global.ResizeObserver;
    else global.ResizeObserver = previousResizeObserver;
  }
  renderer.THREE = {
    SphereGeometry: class { constructor(radius) { this.radius = radius; } },
    WireframeGeometry: class { constructor(geometry) { this.geometry = geometry; } },
    LineBasicMaterial: class { constructor(options) { Object.assign(this, options); } },
    LineSegments: class { constructor(geometry, material) { Object.assign(this, { geometry, material }); } },
  };
  let data, replacements = 0;
  let colorAccessor = null, objectAccessor = renderer.nodeThreeObjectFn;
  const graph = {
    graphData(...args) {
      if (args.length) {
        assert.equal(replacements++, 0, "Group edit replaced graph data");
        data = args[0];
        return graph;
      }
      return data;
    },
    nodeColor(accessor) { colorAccessor = accessor; return graph; },
    nodeThreeObject(accessor) {
      assert.notStrictEqual(accessor, objectAccessor, "Wireframe colors require a fresh accessor");
      objectAccessor = accessor;
      return graph;
    },
    d3ReheatSimulation() { throw new Error("Group edit reheated the layout"); },
  };
  renderer.graph = graph;
  const a = node("a", 10, 20), missing = { ...node("missing", 100, 20), exists: false };
  a.properties = { affiliation: ["imbued"] };
  missing.properties = { affiliation: ["imbued"] };
  renderer.applyData({ nodes: [a, missing], links: [] });
  assert.deepEqual(data.nodes[0].properties, a.properties, "3D copies must retain property group queries");
  const existingData = data;
  const simulation = forceSimulation3D(data.nodes, 3).alpha(0.02).stop();
  const positions = data.nodes.map(({ x, y, z, vx, vy, vz }) => ({ x, y, z, vx, vy, vz }));

  renderer.updateNodeGroups();
  assert.strictEqual(data, existingData);
  assert.equal(replacements, 1);
  assert.equal(colorAccessor(data.nodes[0]), "#ff0000");
  assert.equal(objectAccessor(data.nodes[1]).material.color, "#ff0000");
  assert.deepEqual(data.nodes.map(({ x, y, z, vx, vy, vz }) => ({ x, y, z, vx, vy, vz })), positions);
  assert.equal(simulation.alpha(), 0.02);

  renderer.settings.nodeGroups[0].color = "#00ff00";
  renderer.updateNodeGroups();
  assert.equal(colorAccessor(data.nodes[0]), "#00ff00");
  assert.equal(objectAccessor(data.nodes[1]).material.color, "#00ff00");
  renderer.settings.nodeGroups = [];
  renderer.updateNodeGroups();
  assert.equal(colorAccessor(data.nodes[0]), renderer.settings.nodeColor);
  assert.equal(objectAccessor(data.nodes[1]).material.color, renderer.settings.nodeColor);
  assert.equal(replacements, 1);
  assert.equal(simulation.alpha(), 0.02);

  renderer.graph = null;
  renderer.settings.nodeGroups = [{ query: "file:a", color: "#0000ff" }];
  renderer.pendingData = { nodes: [a], links: [] };
  renderer.updateNodeGroups();
  assert.equal(a.groupColor, "#0000ff", "Group changes before 3D initialization must reach pending nodes");
});

test("both renderers respect arrow overrides and multiply semantic distance with legacy rules", () => {
  for (const Renderer of [GraphRenderer2D, GraphRenderer3D]) {
    const renderer = Object.create(Renderer.prototype);
    renderer.settings = settings({
      relation: createLinkTypeConfig("#ff0000", { distanceMultiplier: 2, attraction: 0.25, arrowMode: "inherit", forceRule: "distance:1.5x" }),
    }, { linkDistance: 60, linkStrength: 0.8 });
    renderer.forceRuleCache = new Map();
    renderer.rebuildForceRuleCache();
    const link = { type: "relation" };
    assert.equal(renderer.getLinkDistance(link), 180);
    assert.equal(renderer.getLinkStrength(link), 0.2);
    assert.equal(renderer.shouldShowArrow(link), false);
    renderer.settings.showArrows = true;
    assert.equal(renderer.shouldShowArrow(link), true);
    renderer.settings.linkTypes.relation.arrowMode = "off";
    assert.equal(renderer.shouldShowArrow(link), false);
    renderer.settings.showArrows = false;
    renderer.settings.linkTypes.relation.arrowMode = "on";
    assert.equal(renderer.shouldShowArrow(link), true);
    renderer.settings.linkTypes.relation.attraction = 0;
    assert.equal(renderer.getLinkStrength(link), 0);
  }
});

test("maximum attraction combinations stay bounded in real 2D and 3D d3 simulations", () => {
  for (const [Renderer, simulate, linkForce, chargeForce, is3D] of [
    [GraphRenderer2D, forceSimulation, forceLink, forceManyBody, false],
    [GraphRenderer3D, forceSimulation3D, forceLink3D, forceManyBody3D, true],
  ]) {
    const renderer = Object.create(Renderer.prototype);
    renderer.settings = settings({
      strong: createLinkTypeConfig("#ff0000", { attraction: 3 }),
      weak: createLinkTypeConfig("#00ff00", { attraction: 0.25 }),
      none: createLinkTypeConfig("#0000ff", { attraction: 0 }),
    }, { linkStrength: 2 });
    renderer.forceRuleCache = new Map();
    assert.equal(renderer.getLinkStrength({ type: "strong" }), 2);
    assert.equal(renderer.getLinkStrength({ type: "weak" }), 0.5);
    assert.equal(renderer.getLinkStrength({ type: "none" }), 0);

    for (const topology of ["chain", "complete"]) {
      const nodes = Array.from({ length: 8 }, (_, i) => ({ id: String(i) }));
      const links = [];
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          if (topology === "chain" && j !== i + 1) continue;
          links.push({ source: String(i), target: String(j), type: "strong" });
        }
      }
      const centerX = is3D ? 0 : 400, centerY = is3D ? 0 : 300;
      const simulation = (is3D ? simulate(nodes, 3) : simulate(nodes))
        .force("charge", chargeForce().strength(-120))
        .force("x", forceX(centerX).strength(0.1))
        .force("y", forceY(centerY).strength(0.1))
        .force("link", linkForce(links).id(n => n.id)
          .distance(l => renderer.getLinkDistance(l))
          .strength(l => renderer.getLinkStrength(l)))
        .stop();
      if (is3D) simulation.force("z", forceZ(0).strength(0.1));
      else simulation.force("collide", forceCollide(7).strength(0.7));
      for (let tick = 0; tick < 300; tick++) {
        simulation.tick();
        for (const node of nodes) {
          const extent = Math.hypot(node.x - centerX, node.y - centerY, is3D ? node.z : 0);
          assert.ok(Number.isFinite(extent) && extent < 1000, `${Renderer.name} ${topology} diverged at tick ${tick}: ${extent}`);
        }
      }
    }
  }
});

const explicitRelation = (id = "r-1", members = ["a", "b", "c"]) => Object.freeze({
  id, type: "alliance", ordered: false, members: Object.freeze(members),
  sourcePath: `Relations/${id}.md`, sourceName: `Alliance ${id}`,
});

test("2D relationship junctions draw labelled diamonds and unordered membership never draws arrows", () => {
  const relation = explicitRelation();
  const junction = { ...node("\u0000relation:r-1", 100, 100), relation, groupColor: "#wrong-group" };
  const a = node("a", 150, 100);
  const renderer = fixture2D(settings({
    alliance: createLinkTypeConfig("#12abcd", { arrowMode: "on", lineStyle: "dotted", widthMultiplier: 2, opacity: 0.4 }),
  }, { showNodeLabels: false, showArrows: true, showLabels: true }), [
    { source: junction, target: a, type: "alliance", curvature: 0, kind: "membership", relationId: relation.id, memberCount: 3 },
  ], [junction, a]);
  renderer.transform.k = 0.4;
  renderer.render();
  const [incidence, diamondFill, diamondOutline, entityFill] = renderer.ctx.draws;
  assert.equal(incidence.kind, "stroke");
  assert.equal(incidence.color, "#12abcd");
  assert.equal(incidence.lineWidth, 3);
  assert.equal(incidence.alpha, 0.4);
  assert.deepEqual(incidence.dash, [0, 7.5]);
  assert.deepEqual(diamondFill.path.map(command => command[0]),
    ["moveTo", "lineTo", "lineTo", "lineTo", "closePath"]);
  assert.equal(diamondOutline.color, "#12abcd", "Junction type color takes priority over entity groups");
  assert.equal(entityFill.path[0][0], "arc", "Ordinary entities retain their circles");
  assert.equal(renderer.ctx.draws.filter(draw => draw.kind === "fill").length, 2, "No membership arrowhead was drawn");
  assert.deepEqual(renderer.ctx.labels.map(label => label.text), ["Alliance r-1 [r-1]"]);
  assert.equal(renderer.shouldShowArrow({ type: "alliance" }), true, "Ordinary links retain arrow overrides");
});

test("2D junction selection exposes the complete authored relation and opens its source without a callback", () => {
  const relation = explicitRelation();
  const junction = { ...node("\u0000relation:r-1", 100, 100), relation };
  const renderer = fixture2D(settings(), [], [junction]);
  let selected;
  const opened = [];
  renderer.app = { workspace: { openLinkText: (...args) => opened.push(args) } };
  renderer.onSelectRelation = record => { selected = record; };
  renderer.selectNode(junction);
  assert.strictEqual(selected, relation);
  assert.deepEqual(selected.members, ["a", "b", "c"]);
  assert.equal(opened.length, 0);
  renderer.selectNode(node("a", 150, 100));
  assert.deepEqual(opened.pop(), ["a", "", false]);
  renderer.onSelectRelation = undefined;
  renderer.selectNode(junction);
  assert.deepEqual(opened.pop(), ["Relations/r-1.md", "", false]);
});

test("2D membership springs normalize a bounded relation budget and ignore directional force rules", () => {
  const renderer = fixture2D(settings({
    alliance: createLinkTypeConfig("#12abcd", { attraction: 3, distanceMultiplier: 2 }),
  }, { linkStrength: 2, linkDistance: 60 }), [], []);
  renderer.forceRuleCache.set("alliance", [{ type: "distance", value: 1.5 }, { type: "direction", dir: "down", value: 1 }]);
  for (const size of [2, 3, 10, 50]) {
    const link = { type: "alliance", kind: "membership", memberCount: size };
    assert.equal(renderer.getLinkStrength(link), 2 / size);
    assert.equal(renderer.getLinkStrength(link) * size, 2);
    assert.equal(renderer.getLinkDistance(link), 180, "Distance is participant-to-junction distance");
  }
  const junction = { ...node("junction", 0, 0), vx: 0, vy: 0 };
  const participant = { ...node("a", 10, 10), vx: 0, vy: 0 };
  renderer.links = [{ source: junction, target: participant, type: "alliance", kind: "membership", memberCount: 3, curvature: 0 }];
  const applyDirection = renderer.createLinkTypeForce();
  applyDirection(0.2);
  assert.equal(participant.vy, 0, "Unordered membership has no invented down direction");
  delete renderer.links[0].kind;
  applyDirection(0.2);
  assert.equal(participant.vy, 10, "Ordinary directed link rules are preserved");
});

test("2D metadata refreshes and paused topology changes preserve positions, pins, camera and semantic source objects", () => {
  const a = { ...node("a", 10, 20), vx: 0.2, vy: -0.1, fx: 10, fy: 20 };
  const b = { ...node("b", 100, 40), vx: -0.2, vy: 0.1 };
  const renderer = fixture2D(settings({ alliance: createLinkTypeConfig("#12abcd") }, { animate: false }), [], [a, b]);
  renderer.simulation = forceSimulation(renderer.nodes).alpha(0.07).stop();
  renderer.transform = { x: 213, y: -51, k: 2.25 };
  let restarts = 0;
  const restart = renderer.simulation.restart.bind(renderer.simulation);
  renderer.simulation.restart = () => { restarts++; return restart(); };
  const ordinaryData = {
    nodes: [Object.freeze({ ...a, tags: Object.freeze([]), properties: Object.freeze({}) }), Object.freeze({ ...b })],
    links: [Object.freeze({ source: "a", target: "b", type: "alliance", curvature: 0 })],
  };
  renderer.updateData(ordinaryData);
  const originalCamera = renderer.transform;
  const positions = renderer.nodes.map(({ x, y, vx, vy, fx, fy }) => ({ x, y, vx, vy, fx, fy }));
  const originalNodes = renderer.nodes;
  const originalLinks = renderer.links;
  const originalRestarts = restarts;
  renderer.simulation.alpha(0.07);
  renderer.updateData({ ...ordinaryData, nodes: ordinaryData.nodes.map(n => ({ ...n, name: `Renamed ${n.id}` })) });
  assert.strictEqual(renderer.nodes, originalNodes);
  assert.strictEqual(renderer.links, originalLinks);
  assert.equal(renderer.nodes[0].name, "Renamed a");
  assert.equal(restarts, originalRestarts);
  assert.equal(renderer.simulation.alpha(), 0.07);
  assert.deepEqual(renderer.nodes.map(({ x, y, vx, vy, fx, fy }) => ({ x, y, vx, vy, fx, fy })), positions);

  const relation = explicitRelation("new", ["a", "b"]);
  const junction = Object.freeze({ ...node("\u0000relation:new", undefined, undefined), relation });
  const projected = {
    nodes: [...ordinaryData.nodes, junction],
    links: [...ordinaryData.links, ...relation.members.map(target => Object.freeze({
      source: junction.id, target, type: relation.type, curvature: 0, kind: "membership", relationId: relation.id, memberCount: relation.members.length,
    }))],
  };
  renderer.updateData(projected);
  assert.strictEqual(renderer.nodes[0], a);
  assert.strictEqual(renderer.nodes[1], b);
  assert.strictEqual(renderer.transform, originalCamera);
  assert.deepEqual(renderer.nodes.slice(0, 2).map(({ x, y, vx, vy, fx, fy }) => ({ x, y, vx, vy, fx, fy })), positions);
  assert.deepEqual([renderer.nodes[2].x, renderer.nodes[2].y], [55, 30], "New junction starts at member centroid");
  assert.equal(junction.x, undefined, "Projection source is never mutated by the simulation");
  assert.equal(projected.links[1].source, junction.id, "Source link endpoints remain semantic IDs");
  assert.strictEqual(renderer.nodes[2].relation, relation);
  renderer.simulation.stop();
});

test("3D standard graph retains relation notes and membership metadata without invented arrows or direction", () => {
  // Exercise applyData and the actual installed d3-force-3d link objects; this
  // deliberately does not instantiate WebGL or claim a native Obsidian check.
  const renderer = Object.create(GraphRenderer3D.prototype);
  renderer.settings = settings({
    alliance: createLinkTypeConfig("#12abcd", {
      attraction: 3, distanceMultiplier: 2, arrowMode: "on", forceRule: "down:1 distance:1.5x",
    }),
  }, { linkStrength: 2, linkDistance: 60, showArrows: true });
  renderer.forceRuleCache = new Map();
  const relation = explicitRelation();
  const source = node(relation.sourcePath, 0, 0);
  const members = relation.members.map((id, index) => node(id, (index + 1) * 30, 0));
  const input = {
    nodes: [source, ...members],
    links: [
      ...members.map(member => Object.freeze({
        source, target: member, type: relation.type, curvature: 0,
        kind: "membership", relationId: relation.id, memberCount: members.length,
      })),
      Object.freeze({ source: members[0], target: members[1], type: relation.type, curvature: 0 }),
    ],
  };
  let data, simulation;
  renderer.graph = {
    graphData(value) { data = value; },
    d3Force(name) { return simulation.force(name); },
  };
  renderer.applyData(input);
  assert.deepEqual(data.nodes.map(n => n.id), ["Relations/r-1.md", "a", "b", "c"]);
  assert.ok(data.nodes.every(n => !n.relation), "Standard 3D uses real note nodes without synthetic junctions");
  assert.deepEqual(data.links.slice(0, 3).map(({ source, target, kind, relationId, memberCount }) =>
    ({ source, target, kind, relationId, memberCount })), relation.members.map(target => ({
    source: relation.sourcePath, target, kind: "membership", relationId: relation.id, memberCount: 3,
  })));
  for (const link of data.links.slice(0, 3)) {
    assert.equal(renderer.getLinkStrength(link), 2 / 3);
    assert.equal(renderer.getLinkDistance(link), 180);
    assert.equal(renderer.shouldShowArrow(link), false);
  }
  assert.equal(renderer.getLinkStrength(data.links[3]), 2);
  assert.equal(renderer.shouldShowArrow(data.links[3]), true);

  simulation = forceSimulation3D(data.nodes, 3)
    .force("link", forceLink3D(data.links).id(n => n.id)
      .strength(l => renderer.getLinkStrength(l)).distance(l => renderer.getLinkDistance(l)))
    .stop();
  renderer.createLinkTypeForce()(0.2);
  const byId = new Map(data.nodes.map(n => [n.id, n]));
  assert.equal(byId.get("a").vy, 0);
  assert.equal(byId.get("c").vy, 0);
  assert.equal(byId.get("b").vy, -10, "Only the ordinary a-to-b rule applies the 3D down force");
  assert.strictEqual(input.links[0].source, source, "Rendering does not mutate source membership endpoints");
  assert.strictEqual(input.links[0].target, members[0]);
  simulation.stop();
});

test("2D resize redraws a paused graph without changing positions, camera, alpha or restarting physics", () => {
  const a = { ...node("a", 10, 20), vx: 0.2, vy: -0.1, fx: 10, fy: 20 };
  const b = { ...node("b", 100, 40), vx: -0.2, vy: 0.1 };
  const renderer = fixture2D(settings({}, { animate: false, showNodeLabels: false }), [], [a, b]);
  const xForce = forceX(400).strength(0.1);
  const yForce = forceY(300).strength(0.1);
  renderer.simulation = forceSimulation(renderer.nodes)
    .force("x", xForce).force("y", yForce).alpha(0.037).alphaTarget(0).stop();
  const camera = renderer.transform = { x: 237, y: -61, k: 1.75 };
  const positions = renderer.nodes.map(({ x, y, vx, vy, fx, fy }) => ({ x, y, vx, vy, fx, fy }));
  let sizes = 0, restarts = 0, renders = 0;
  renderer.updateSize = () => { sizes++; renderer.width = 1000; renderer.height = 700; };
  const restart = renderer.simulation.restart.bind(renderer.simulation);
  renderer.simulation.restart = () => { restarts++; return restart(); };
  const render = renderer.render.bind(renderer);
  renderer.render = () => { renders++; render(); };
  try {
    renderer.handleResize();
    renderer.handleResize(); // Covers the hide/show notifications from opening a note.
    assert.equal(sizes, 2);
    assert.equal(renders, 2);
    assert.equal(xForce.x()(a), 500);
    assert.equal(yForce.y()(a), 350);
    assert.equal(restarts, 0);
    assert.equal(renderer.simulation.alpha(), 0.037);
    assert.equal(renderer.simulation.alphaTarget(), 0);
    assert.strictEqual(renderer.transform, camera);
    assert.deepEqual(renderer.nodes.map(({ x, y, vx, vy, fx, fy }) => ({ x, y, vx, vy, fx, fy })), positions);

    renderer.settings.animate = true;
    renderer.handleResize();
    assert.equal(sizes, 3);
    assert.equal(renders, 3);
    assert.equal(restarts, 1, "Animated graphs retain the existing resize restart behavior");
    assert.equal(renderer.simulation.alpha(), 0.1);
  } finally {
    renderer.simulation.stop();
  }
});

test("paused 2D projection toggles retain source-note and junction layout without duplicating entities", () => {
  const relation = explicitRelation("toggle", ["a", "b"]);
  const junctionId = "\u0000relation:toggle";
  const makeData = junctions => ({
    nodes: [node("a", undefined, undefined), node("b", undefined, undefined), {
      ...node(junctions ? junctionId : relation.sourcePath, undefined, undefined),
      name: relation.sourceName,
      properties: { graph_kind: ["relation"], graph_id: [relation.id] },
      ...(junctions ? { relation } : {}),
    }],
    links: relation.members.map(target => ({
      source: junctions ? junctionId : relation.sourcePath, target, type: relation.type,
      curvature: 0, kind: "membership", relationId: relation.id, memberCount: relation.members.length,
    })),
  });
  const renderer = fixture2D(settings({ alliance: createLinkTypeConfig("#12abcd") }, { animate: false }), [], []);
  renderer.simulation = forceSimulation([]).stop();
  const camera = renderer.transform = { x: 137, y: -45, k: 1.8 };
  try {
    renderer.updateData(makeData(true));
    const original = [...renderer.nodes];
    original.forEach((n, index) => Object.assign(n, {
      x: 80 + index * 50, y: 120 + index * 30,
      vx: index * 0.15, vy: index * -0.1, fx: null, fy: null,
    }));
    Object.assign(original[2], { fx: original[2].x, fy: original[2].y });
    const layout = original.map(({ x, y, vx, vy, fx, fy }) => ({ x, y, vx, vy, fx, fy }));
    for (const junctions of [false, true, false, true]) {
      renderer.updateData(makeData(junctions));
      assert.strictEqual(renderer.transform, camera);
      assert.equal(renderer.nodes.length, 3);
      assert.equal(new Set(renderer.nodes).size, 3, "Representations do not share a duplicated layout object");
      assert.deepEqual(renderer.nodes.map(n => n.id), ["a", "b", junctions ? junctionId : relation.sourcePath]);
      renderer.nodes.forEach((n, index) => assert.strictEqual(n, original[index]));
      assert.deepEqual(renderer.nodes.map(({ x, y, vx, vy, fx, fy }) => ({ x, y, vx, vy, fx, fy })), layout);
      assert.equal(renderer.nodes[2].relation, junctions ? relation : undefined, "Standard notes do not retain junction metadata");
      assert.deepEqual(renderer.nodes[2].properties.graph_id, [relation.id]);
      assert.ok(renderer.links.every(l => l.source === renderer.nodes[2]));
    }
  } finally {
    renderer.simulation.stop();
  }
});

test("paused 2D junction clicks do not resume physics and dragging moves only the selected node", () => {
  const junction = { ...node("\u0000relation:r-1", 100, 120), relation: explicitRelation(), vx: 0.2, vy: -0.1 };
  const entity = { ...node("a", 250, 170), vx: -0.1, vy: 0.2 };
  const renderer = fixture2D(settings({}, { animate: false }), [], [junction, entity]);
  renderer.simulation = forceSimulation(renderer.nodes).alpha(0.037).alphaTarget(0).stop();
  const camera = renderer.transform = { x: 200, y: -40, k: 2 };
  let restarts = 0;
  const restart = renderer.simulation.restart.bind(renderer.simulation);
  renderer.simulation.restart = () => { restarts++; return restart(); };
  const positions = renderer.nodes.map(({ x, y, vx, vy }) => ({ x, y, vx, vy }));
  try {
    renderer.startNodeDrag(junction, 0);
    renderer.endNodeDrag(junction, 0); // Plain mousedown/mouseup followed by inspection.
    assert.equal(restarts, 0);
    assert.equal(renderer.simulation.alpha(), 0.037);
    assert.equal(renderer.simulation.alphaTarget(), 0);
    assert.deepEqual(renderer.nodes.map(({ x, y, vx, vy }) => ({ x, y, vx, vy })), positions);

    renderer.startNodeDrag(junction, 0);
    renderer.moveNodeDrag(junction, 500, 320);
    assert.deepEqual([junction.x, junction.y, junction.fx, junction.fy], [150, 180, 150, 180]);
    assert.deepEqual({ x: entity.x, y: entity.y, vx: entity.vx, vy: entity.vy }, positions[1]);
    assert.equal(restarts, 0);
    assert.equal(renderer.simulation.alpha(), 0.037);
    assert.strictEqual(renderer.transform, camera);
    assert.ok(renderer.ctx.draws.length > 0, "Paused dragging redraws the node without simulation ticks");
    renderer.endNodeDrag(junction, 0);
    assert.deepEqual([junction.fx, junction.fy], [null, null]);

    renderer.settings.animate = true;
    renderer.startNodeDrag(junction, 0);
    assert.equal(restarts, 1);
    assert.equal(renderer.simulation.alphaTarget(), 0.3);
    const activePosition = { x: junction.x, y: junction.y };
    renderer.moveNodeDrag(junction, 540, 360);
    assert.deepEqual([junction.fx, junction.fy], [170, 200]);
    assert.deepEqual({ x: junction.x, y: junction.y }, activePosition, "Animated dragging leaves movement to d3 ticks");
    renderer.endNodeDrag(junction, 0);
    assert.equal(renderer.simulation.alphaTarget(), 0);
    assert.deepEqual([junction.fx, junction.fy], [null, null]);
  } finally {
    renderer.simulation.stop();
  }
});
