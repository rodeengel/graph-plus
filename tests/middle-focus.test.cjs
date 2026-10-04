const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const esbuild = require("esbuild");

// Use the installed navigation and node-drag controls, rather than assuming
// their handlers ignore middle buttons. This is a DOM-event regression, not a
// WebGL or native Obsidian acceptance test.
const root = path.resolve(__dirname, "..");
const bundle = esbuild.buildSync({
  stdin: {
    contents: [
      'export { GraphRenderer3D } from "./src/graphRenderer3D";',
      'export { DEFAULT_SETTINGS } from "./src/types";',
      'export { TrackballControls } from "three/examples/jsm/controls/TrackballControls.js";',
      'export { DragControls } from "three/examples/jsm/controls/DragControls.js";',
      'export * as THREE from "three";',
    ].join("\n"),
    resolveDir: root,
    loader: "ts",
  },
  bundle: true, platform: "node", format: "cjs", target: "es2020",
  write: false, logLevel: "silent",
});
const compiled = new Module(path.join(__dirname, "middle-focus.generated.cjs"), module);
compiled.filename = compiled.id;
compiled.paths = module.paths;
compiled._compile(bundle.outputFiles[0].text, compiled.filename);
const { GraphRenderer3D, DEFAULT_SETTINGS, TrackballControls, DragControls, THREE } = compiled.exports;

class PointerFixtureEvent extends Event {
  constructor(type, init = {}) {
    super(type, { bubbles: init.bubbles ?? true, cancelable: init.cancelable ?? true });
    this.button = init.button ?? 1;
    this.buttons = init.buttons ?? (type === "pointerup" ? 0 : 4);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? "mouse";
    this.clientX = init.clientX ?? 0;
    this.clientY = init.clientY ?? 0;
    this.pageX = init.pageX ?? this.clientX;
    this.pageY = init.pageY ?? this.clientY;
    this.pressure = init.pressure ?? (this.buttons ? 0.5 : 0);
    this.movementX = init.movementX ?? 0;
    this.movementY = init.movementY ?? 0;
    this.propagationStopped = false;
    this.immediatePropagationStopped = false;
  }
  stopPropagation() { this.propagationStopped = true; super.stopPropagation(); }
  stopImmediatePropagation() {
    this.immediatePropagationStopped = this.propagationStopped = true;
    super.stopImmediatePropagation();
  }
}

// A small event tree preserves browser capture/bubble ordering. Three's real
// controls only need these event, sizing, style, and pointer-capture methods.
class DomFixture {
  constructor(ownerDocument = null) {
    this.ownerDocument = ownerDocument;
    this.parentElement = null;
    this.style = {};
    this.listeners = new Map();
    this.captures = new Set();
    this.clientWidth = this.clientHeight = 400;
  }
  addEventListener(type, callback, options = false) {
    const capture = typeof options === "boolean" ? options : !!options.capture;
    const entries = this.listeners.get(type) ?? [];
    if (!entries.some(entry => entry.callback === callback && entry.capture === capture)) {
      entries.push({ callback, capture });
    }
    this.listeners.set(type, entries);
  }
  removeEventListener(type, callback, options = false) {
    const capture = typeof options === "boolean" ? options : !!options.capture;
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter(entry =>
      entry.callback !== callback || entry.capture !== capture));
  }
  dispatchEvent(event) {
    const ancestors = [];
    for (let parent = this.parentElement; parent; parent = parent.parentElement) ancestors.push(parent);
    const dispatch = (target, capture) => {
      Object.defineProperty(event, "currentTarget", { configurable: true, value: target });
      for (const entry of [...(target.listeners.get(event.type) ?? [])]) {
        if (entry.capture !== capture) continue;
        entry.callback.call(target, event);
        if (event.immediatePropagationStopped) break;
      }
    };
    Object.defineProperty(event, "target", { configurable: true, value: this });
    for (const parent of [...ancestors].reverse()) {
      dispatch(parent, true);
      if (event.propagationStopped) return !event.defaultPrevented;
    }
    dispatch(this, true);
    if (!event.immediatePropagationStopped) dispatch(this, false);
    if (event.bubbles && !event.propagationStopped) {
      for (const parent of ancestors) {
        dispatch(parent, false);
        if (event.propagationStopped) break;
      }
    }
    return !event.defaultPrevented;
  }
  getBoundingClientRect() { return { left: 0, top: 0, width: 400, height: 400 }; }
  setPointerCapture(id) { this.captures.add(id); }
  releasePointerCapture(id) { this.captures.delete(id); }
  appendChild(child) { child.parentElement = this; }
  empty() {}
  remove() {}
}

test("registered 3D middle gestures reach real navigation controls without triggering real node dragging or leaving hover bookkeeping stuck", () => {
  const source = fs.readFileSync(path.join(root, "src", "graphRenderer3D.ts"), "utf8");
  const constructorAt = source.indexOf("new ForceGraph3D(this.wrapper)");
  const registrationAt = source.indexOf("this.attachFocusInteractions(");
  const pendingDataAt = source.indexOf("this.applyData(this.pendingData)");
  assert.ok(constructorAt >= 0 && constructorAt < registrationAt && registrationAt < pendingDataAt,
    "Production registers focus after the navigation constructor and before its first pending graph-data update");
  // The installed library creates navigation controls synchronously and node
  // DragControls in the later force-graph digest. Guard that dependency order.
  const renderSource = fs.readFileSync(path.join(root, "node_modules", "three-render-objects", "dist", "three-render-objects.mjs"), "utf8");
  const graphSource = fs.readFileSync(path.join(root, "node_modules", "3d-force-graph", "dist", "3d-force-graph.mjs"), "utf8");
  assert.ok(renderSource.includes("state.controls = new"));
  assert.ok(graphSource.indexOf(".onFinishUpdate(") < graphSource.indexOf("new DragControls("));

  const previous = { window: global.window, document: global.document, ResizeObserver: global.ResizeObserver, PointerEvent: global.PointerEvent };
  const originalInit = GraphRenderer3D.prototype.initGraph;
  const doc = new DomFixture();
  doc.documentElement = { clientLeft: 0, clientTop: 0 };
  doc.createElement = () => new DomFixture(doc);
  const win = new DomFixture();
  win.pageXOffset = win.pageYOffset = 0;
  global.window = win;
  global.document = doc;
  global.PointerEvent = PointerFixtureEvent;
  global.ResizeObserver = class { observe() {} disconnect() {} };
  GraphRenderer3D.prototype.initGraph = () => {};
  let renderer, navigation, nodeDrag, mesh;
  try {
    renderer = new GraphRenderer3D(new DomFixture(doc), {
      workspace: { openLinkText() { throw new Error("Middle focus opened a note"); } },
    }, structuredClone(DEFAULT_SETTINGS));
    const parent = new DomFixture(doc);
    parent.parentElement = doc;
    const canvas = new DomFixture(doc);
    canvas.parentElement = parent;
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    camera.position.set(0, 0, 100);
    const scene = new THREE.Scene();
    const node = { id: "A.md", x: 12, y: 3, z: 0, vx: 0.2, vy: -0.1, vz: 0.3, fx: 12 };
    const layout = { ...node };
    mesh = new THREE.Mesh(new THREE.SphereGeometry(6, 16, 12), new THREE.MeshBasicMaterial());
    mesh.position.set(node.x, node.y, node.z);
    mesh.__graphObjType = "node";
    mesh.__data = node;
    node.__threeObj = mesh;
    scene.add(mesh);

    // Mirror only the scene parent's pointer bookkeeping from the installed
    // renderer; picking, camera focus, navigation and node-drag handlers are real.
    const bookkeeping = { pressed: false, dragging: false };
    for (const type of ["pointerdown", "pointermove"]) parent.addEventListener(type, event => {
      if (type === "pointerdown") bookkeeping.pressed = true;
      if (type === "pointermove" && (event.pressure > 0 || bookkeeping.pressed)) bookkeeping.dragging = true;
    });
    parent.addEventListener("pointerup", () => {
      if (!bookkeeping.pressed) return;
      bookkeeping.pressed = false;
      bookkeeping.dragging = false;
    }, true);

    navigation = new TrackballControls(camera, canvas);
    navigation.staticMoving = true;
    let focusCalls = 0;
    renderer.THREE = THREE;
    renderer.graph = {
      graphData: () => ({ nodes: [node] }),
      renderer: () => ({ domElement: canvas }),
      camera: () => camera, scene: () => scene, controls: () => navigation,
      cameraPosition(position, target) {
        if (!position) return { x: camera.position.x, y: camera.position.y, z: camera.position.z };
        focusCalls++;
        camera.position.set(position.x, position.y, position.z);
        if (navigation.enabled) navigation.target = new THREE.Vector3(target.x, target.y, target.z);
        else camera.lookAt(new THREE.Vector3(target.x, target.y, target.z));
      },
      d3ReheatSimulation() { throw new Error("Middle focus restarted layout"); },
    };
    renderer.attachFocusInteractions(canvas);
    nodeDrag = new DragControls([mesh], camera, canvas);
    let dragStarts = 0, dragMoves = 0;
    nodeDrag.addEventListener("dragstart", () => {
      dragStarts++;
      navigation.enabled = false;
      node.fx = node.x; node.fy = node.y; node.fz = node.z;
    });
    nodeDrag.addEventListener("drag", () => { dragMoves++; });
    nodeDrag.addEventListener("dragend", () => {
      navigation.enabled = true;
      for (const key of ["fx", "fy", "fz"]) {
        if (Object.hasOwn(layout, key)) node[key] = layout[key];
        else delete node[key];
      }
    });
    const point = () => {
      scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
      const projected = new THREE.Vector3(node.x, node.y, node.z).project(camera);
      return { clientX: (projected.x + 1) * 200, clientY: (1 - projected.y) * 200 };
    };
    const pointer = (type, coords, init = {}) => canvas.dispatchEvent(new PointerFixtureEvent(type, { ...coords, ...init }));
    const unchangedLayout = () => {
      for (const key of Object.keys(layout)) assert.equal(node[key], layout[key], `Middle gesture preserves ${key}`);
      assert.equal(Object.hasOwn(node, "fy"), false);
      assert.equal(Object.hasOwn(node, "fz"), false);
    };

    const clicked = point();
    const offset = camera.position.clone().sub(navigation.target);
    pointer("pointerdown", clicked);
    assert.equal(navigation.enabled, true);
    assert.equal(dragStarts, 0, "Real DragControls did not receive the middle press");
    assert.equal(bookkeeping.pressed, true, "Scene parent still receives middle-press bookkeeping");
    unchangedLayout();
    pointer("pointerup", clicked);
    navigation.update();
    assert.equal(focusCalls, 1);
    assert.ok(navigation.target.distanceTo(new THREE.Vector3(node.x, node.y, node.z)) < 1e-8);
    assert.ok(camera.position.clone().sub(navigation.target).distanceTo(offset) < 1e-8,
      "Actual enabled navigation retains the focused camera offset");
    assert.deepEqual(bookkeeping, { pressed: false, dragging: false });
    unchangedLayout();

    const dragged = point();
    const priorDistance = camera.position.distanceTo(navigation.target);
    pointer("pointerdown", dragged);
    pointer("pointermove", { clientX: dragged.clientX, clientY: dragged.clientY + 45 }, { button: -1, movementY: 45 });
    navigation.update();
    assert.notEqual(camera.position.distanceTo(navigation.target), priorDistance, "Actual TrackballControls still dollies on a middle drag");
    pointer("pointerup", { clientX: dragged.clientX, clientY: dragged.clientY + 45 });
    assert.equal(focusCalls, 1, "Middle dragging does not become a focus click");
    assert.equal(dragStarts, 0);
    assert.equal(dragMoves, 0);
    assert.deepEqual(bookkeeping, { pressed: false, dragging: false }, "Parent hover/drag state is released after middle navigation");
    unchangedLayout();

    // Ordinary node dragging remains routed to the same real control instance.
    const left = point();
    pointer("pointerdown", left, { button: 0, buttons: 1 });
    assert.equal(dragStarts, 1, "Left-button node dragging remains enabled");
    pointer("pointerup", left, { button: 0, buttons: 0 });
    assert.equal(navigation.enabled, true);
  } finally {
    nodeDrag?.dispose();
    navigation?.dispose();
    renderer?.destroy();
    mesh?.geometry.dispose(); mesh?.material.dispose();
    GraphRenderer3D.prototype.initGraph = originalInit;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete global[key];
      else global[key] = value;
    }
  }
});
