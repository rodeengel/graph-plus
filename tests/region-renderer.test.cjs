const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const esbuild = require("esbuild");

// Record the real renderer's Canvas instructions and use the installed d3.
// These host checks do not claim native Obsidian or visual acceptance.
const result = esbuild.buildSync({
  stdin: {
    contents: [
      'export { GraphRenderer2D } from "./src/graphRenderer2D";',
      'export { DEFAULT_SETTINGS, createLinkTypeConfig } from "./src/types";',
      'export { forceSimulation } from "d3-force";',
    ].join("\n"),
    resolveDir: path.resolve(__dirname, ".."), loader: "ts",
  },
  bundle: true, platform: "node", format: "cjs", target: "es2020", write: false, logLevel: "silent",
});
const compiled = new Module(path.join(__dirname, "region-renderer.generated.cjs"), module);
compiled.filename = compiled.id;
compiled.paths = module.paths;
compiled._compile(result.outputFiles[0].text, compiled.filename);
const { GraphRenderer2D, DEFAULT_SETTINGS, createLinkTypeConfig, forceSimulation } = compiled.exports;

function recordingContext() {
  const events = [], stack = [];
  let currentPath = [], dash = [];
  const keys = ["globalAlpha", "lineWidth", "lineCap", "lineJoin", "fillStyle", "strokeStyle", "font", "textAlign", "textBaseline"];
  const ctx = {
    events, globalAlpha: 1, lineWidth: 1, lineCap: "butt", lineJoin: "miter",
    save() { stack.push({ props: Object.fromEntries(keys.map(key => [key, ctx[key]])), dash: [...dash] }); },
    restore() { const saved = stack.pop(); Object.assign(ctx, saved.props); dash = saved.dash; },
    clearRect() {}, translate() {}, scale() {},
    beginPath() { currentPath = []; },
    moveTo(...args) { currentPath.push(["moveTo", ...args]); },
    lineTo(...args) { currentPath.push(["lineTo", ...args]); },
    quadraticCurveTo(...args) { currentPath.push(["quadraticCurveTo", ...args]); },
    arc(...args) { currentPath.push(["arc", ...args]); },
    closePath() { currentPath.push(["closePath"]); },
    setLineDash(value) { dash = [...value]; },
    fill() { record("fill", ctx.fillStyle); },
    stroke() { record("stroke", ctx.strokeStyle); },
    strokeText() {},
    fillText(text, x, y) { events.push({ kind: "label", text, x, y, alpha: ctx.globalAlpha, color: ctx.fillStyle }); },
  };
  function record(kind, color) {
    events.push({ kind, color, alpha: ctx.globalAlpha, width: ctx.lineWidth, path: [...currentPath], dash: [...dash] });
  }
  return ctx;
}

const node = (id, x, y) => ({ id, name: id, x, y, exists: true, tags: [], properties: {}, isAttachment: false });
const relation = (id, members, type = "band") => Object.freeze({
  id, type, ordered: false, members: Object.freeze(members), sourcePath: `Relations/${id}.md`, sourceName: id,
});
const junction = (record, x, y) => ({ ...node(`\u0000relation:${record.id}`, x, y), relation: record });
const semantic = records => Object.freeze({ entities: [], links: [], diagnostics: [], relations: Object.freeze(records) });
const regionFills = events => events.filter(event => event.kind === "fill" && event.path.length > 8);

function fixture(records, nodes, links = [], overrides = {}) {
  const renderer = Object.create(GraphRenderer2D.prototype);
  Object.assign(renderer, {
    nodes, links, relations: records, selectedRelationId: null, hoveredNode: null,
    settings: { ...DEFAULT_SETTINGS, showLabels: false, showNodeLabels: false, hypergraph2D: true,
      hyperrelationRegions: true, regionFillOpacity: 0.08, animate: false,
      linkTypes: { band: createLinkTypeConfig("#23aabb", { opacity: 0.1, lineStyle: "dashed", widthMultiplier: 3 }),
        pair: createLinkTypeConfig("#ff0000", { arrowMode: "on" }) }, ...overrides },
    ctx: recordingContext(), destroyed: false, forceRuleCache: new Map(),
    transform: { x: 0, y: 0, k: 1 }, width: 800, height: 600,
    resolvedBgColor: "#111111", resolvedTextColor: "#ffffff",
  });
  return renderer;
}

function overlappingFixture() {
  const first = relation("first", ["a", "b", "c"]);
  const second = relation("second", ["a", "d"]);
  const a = node("a", 100, 100), b = node("b", 180, 100), c = node("c", 130, 180), d = node("d", 40, 130);
  const unrelated = node("unrelated", 130, 125);
  const j1 = junction(first, 230, 200), j2 = junction(second, 50, 70);
  const links = [{ source: a, target: b, type: "pair", curvature: 0 }];
  return { renderer: fixture([first, second], [a, b, c, d, unrelated, j1, j2], links), first, second, unrelated };
}

test("regions draw behind links and entity circles, using independent fill opacity and separate same-color identities", () => {
  const { renderer } = overlappingFixture();
  renderer.render();
  const fills = regionFills(renderer.ctx.events);
  assert.equal(fills.length, 2);
  assert.ok(fills.every(fill => fill.color === "#23aabb" && fill.alpha === 0.08));
  assert.ok(fills.every(fill => fill.dash.length === 0), "Region boundaries do not inherit pairwise dash styling");
  const labels = renderer.ctx.events.filter(event => event.kind === "label").map(event => event.text);
  assert.ok(labels.includes("first [first]"));
  assert.ok(labels.includes("second [second]"));
  const lastRegion = Math.max(...fills.map(fill => renderer.ctx.events.indexOf(fill)));
  const pairStroke = renderer.ctx.events.findIndex(event => event.kind === "stroke" && event.color === "#ff0000");
  const entity = renderer.ctx.events.findIndex(event => event.kind === "fill" && event.path[0]?.[0] === "arc");
  assert.ok(lastRegion < pairStroke && pairStroke < entity);
  assert.equal(renderer.nodes.filter(n => n.id === "a").length, 1, "Shared entities remain single nodes");
  renderer.ctx.events.length = 0;
  renderer.settings.regionFillOpacity = 0.2;
  renderer.settings.linkTypes.band.opacity = 0;
  renderer.updateSettings();
  assert.ok(regionFills(renderer.ctx.events).every(fill => fill.alpha === 0.2));
});

test("selected regions outline only direct members, including one nested junction without flattening its members", () => {
  const child = relation("child", ["b", "c"]);
  const parent = relation("parent", ["a", child.sourcePath]);
  const a = node("a", 100, 100), b = node("b", 140, 100), c = node("c", 180, 100);
  const unrelated = node("unrelated", 130, 100);
  const childNode = junction(child, 200, 100), parentNode = junction(parent, 230, 160);
  const renderer = fixture([parent, child], [a, b, c, unrelated, childNode, parentNode]);
  renderer.setSelectedRelation(parent.id);
  assert.deepEqual(renderer.getDisplayedMemberIds(parent), ["a", childNode.id]);
  assert.deepEqual(renderer.getRelationDisplayCount(parent.id), { displayed: 2, total: 2 });
  const outlines = renderer.ctx.events.filter(event => event.kind === "stroke" && event.width === 2.4 && event.alpha === 1);
  assert.equal(outlines.length, 2);
  assert.ok(outlines.some(event => event.path[0][0] === "arc" && event.path[0][1] === a.x));
  assert.ok(outlines.some(event => event.path.length === 5 && event.path[0][1] === childNode.x));
  assert.ok(!outlines.some(event => event.path[0][0] === "arc" && [b.x, c.x, unrelated.x].includes(event.path[0][1])));
  const highlightedBorders = renderer.ctx.events.filter(event => event.kind === "stroke" && event.alpha === 0.9);
  assert.equal(highlightedBorders.length, 1);
});

test("partial 0/1/2 member regions retain authored totals and expose partial labels", () => {
  const record = relation("partial", ["a", "b", "c"]);
  for (const displayed of [0, 1, 2]) {
    const members = record.members.slice(0, displayed).map((id, index) => node(id, 100 + index * 60, 100));
    const renderer = fixture([record], [...members, junction(record, 160, 170)]);
    renderer.render();
    assert.deepEqual(renderer.getRelationDisplayCount(record.id), { displayed, total: 3 });
    assert.deepEqual(record.members, ["a", "b", "c"]);
    assert.equal(regionFills(renderer.ctx.events).length, displayed ? 1 : 0);
    assert.ok(renderer.ctx.events.some(event => event.kind === "label" && event.text.includes(`${displayed}/3 shown (partial)`)));
    if (displayed) assert.equal(renderer.getRelationRegions()[0].geometry.kind, displayed === 1 ? "disc" : "capsule");
  }
  const pending = fixture([record], [node("a", undefined, undefined), junction(record, 160, 170)]);
  assert.deepEqual(pending.getRelationDisplayCount(record.id), { displayed: 1, total: 3 }, "Displayed UI counts do not wait for position initialization");
  assert.equal(pending.getRelationRegions().length, 0, "Geometry requires finite positions");
});

test("region visibility follows projection, source junction, and type filters without inferring membership or adding hit surfaces", () => {
  const { renderer, first, unrelated } = overlappingFixture();
  renderer.setSelectedRelation(first.id);
  assert.strictEqual(renderer.findNode(unrelated.x, unrelated.y), unrelated, "An unrelated node inside a region retains its own hit target");
  assert.equal(renderer.findNode(145, 145), null, "Empty region space is not a selectable invented node");
  for (const change of [
    () => { renderer.settings.hyperrelationRegions = false; },
    () => { renderer.settings.hyperrelationRegions = true; renderer.settings.hypergraph2D = false; },
    () => { renderer.settings.hypergraph2D = true; renderer.settings.linkTypes.band.visible = false; },
  ]) {
    change(); renderer.ctx.events.length = 0; renderer.updateSettings();
    assert.equal(regionFills(renderer.ctx.events).length, 0);
    assert.ok(!renderer.ctx.events.some(event => event.kind === "stroke" && event.alpha === 1 && event.width === 2.4));
  }
  renderer.settings.linkTypes.band.visible = true;
  renderer.nodes = renderer.nodes.filter(n => !n.relation);
  assert.equal(renderer.getRelationRegions().length, 0);
  assert.deepEqual(renderer.getRelationDisplayCount(first.id), { displayed: 3, total: 3 });
  renderer.ctx.events.length = 0;
  renderer.updateSettings();
  assert.equal(renderer.ctx.events.filter(event => event.kind === "stroke" && event.alpha === 1 && event.width === 2.4).length, 3,
    "Selecting a source-filtered record still outlines its direct displayed members");
  renderer.relations = [];
  renderer.links = [
    { source: renderer.nodes[0], target: renderer.nodes[1], type: "band", curvature: 0 },
    { source: renderer.nodes[1], target: renderer.nodes[2], type: "band", curvature: 0 },
    { source: renderer.nodes[2], target: renderer.nodes[0], type: "band", curvature: 0 },
  ];
  assert.equal(renderer.getRelationRegions().length, 0, "Triangles, colors and proximity do not create authored relations");
});

test("region geometry follows live node positions and visual updates preserve simulation and camera state", () => {
  const { renderer, first, second } = overlappingFixture();
  renderer.simulation = forceSimulation(renderer.nodes).stop();
  const input = {
    nodes: renderer.nodes.map(n => ({ ...n })),
    links: renderer.links.map(link => ({ ...link, source: link.source.id, target: link.target.id })),
    semantic: semantic([first, second]),
  };
  renderer.updateData(input);
  renderer.simulation.alpha(0.027).stop();
  Object.assign(renderer.nodes[0], { fx: renderer.nodes[0].x, fy: renderer.nodes[0].y });
  const camera = renderer.transform = { x: 137, y: -61, k: 1.7 };
  const nodes = renderer.nodes, links = renderer.links;
  const positions = nodes.map(({ x, y, vx, vy, fx, fy }) => ({ x, y, vx, vy, fx, fy }));
  renderer.simulation.restart = () => { throw new Error("Region presentation restarted physics"); };
  renderer.simulation.tick = () => { throw new Error("Region presentation ticked physics"); };
  try {
    renderer.setSelectedRelation(first.id);
    renderer.settings.regionFillOpacity = 0.2;
    renderer.updateSettings();
    renderer.settings.hyperrelationRegions = false;
    renderer.updateSettings();
    renderer.settings.hyperrelationRegions = true;
    renderer.settings.linkTypes.band.color = "#c0ffee";
    renderer.updateSettings();
    renderer.setSelectedRelation(null);
    const renamed = Object.freeze({ ...first, sourceName: "Renamed first" });
    const hidden = relation("hidden", ["a", "filtered-b", "filtered-c"]);
    renderer.updateData({ ...input,
      nodes: input.nodes.map(n => n.relation?.id === first.id ? { ...n, relation: renamed } : n),
      semantic: semantic([renamed, second, hidden]),
    });
    assert.strictEqual(renderer.nodes, nodes);
    assert.strictEqual(renderer.links, links);
    assert.strictEqual(renderer.simulation.nodes(), nodes);
    assert.strictEqual(renderer.transform, camera);
    assert.equal(renderer.simulation.alpha(), 0.027);
    assert.deepEqual(nodes.map(({ x, y, vx, vy, fx, fy }) => ({ x, y, vx, vy, fx, fy })), positions);
    assert.deepEqual(renderer.getRelationDisplayCount(hidden.id), { displayed: 1, total: 3 }, "Same-topology refresh retains the full authored records");
    assert.equal(renderer.getRelationRegions().length, 2, "A filtered-out source does not gain a region");
    assert.ok(renderer.ctx.events.some(event => event.kind === "label" && event.text.includes("Renamed first")));
    const before = renderer.getRelationRegions().find(region => region.relation.id === first.id).geometry.bounds.maxX;
    renderer.nodes[1].x += 150;
    const after = renderer.getRelationRegions().find(region => region.relation.id === first.id).geometry.bounds.maxX;
    assert.ok(after > before + 100, "Presentation follows current node positions without replacing topology");
  } finally {
    renderer.simulation.stop();
  }
});
