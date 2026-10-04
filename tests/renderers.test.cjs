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
  let currentPath = [];
  let dash = [];
  const ctx = {
    draws,
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
    strokeText() {}, fillText() {},
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
