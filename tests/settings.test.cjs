const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const esbuild = require("esbuild");

// Run actual view, parser and settings code. Only the Obsidian host controls
// and renderer instances are substituted; these checks do not launch Obsidian.
class HostElement {
  constructor(tag = "div", options = {}) {
    Object.assign(this, options);
    this.tag = tag;
    this.children = [];
    this.settings = [];
    this.listeners = {};
    this.style = { display: "" };
    this.value = "";
    this.scrollTop = 0;
  }
  empty() { this.children = []; this.settings = []; }
  createEl(tag, options) {
    const child = new HostElement(tag, options);
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  createDiv(options) { return this.createEl("div", options); }
  createSpan(options) { return this.createEl("span", options); }
  addEventListener(event, callback) { this.listeners[event] = callback; }
  async fire(event) { await this.listeners[event](); }
  setText(value) { this.text = value; }
  contains(element) { return this === element || this.children.some((child) => child.contains(element)); }
  matches(selector) { return selector.split(",").some((tag) => tag.trim() === this.tag); }
  find(predicate) {
    if (predicate(this)) return this;
    for (const child of this.children) {
      const result = child.find(predicate);
      if (result) return result;
    }
  }
}

class HostControl {
  constructor(kind) { this.kind = kind; }
  addOption() { return this; }
  setValue(value) { this.value = value; return this; }
  setLimits(min, max, step) { this.limits = { min, max, step }; return this; }
  setDisabled(value) { this.disabled = value; return this; }
  setDynamicTooltip() { return this; }
  setTooltip() { return this; }
  setPlaceholder() { return this; }
  setButtonText(value) { this.text = value; return this; }
  setWarning() { return this; }
  onChange(callback) { this.change = callback; return this; }
  onClick(callback) { this.click = callback; return this; }
}

class HostSetting {
  constructor(container) { this.controls = []; container.settings.push(this); }
  setHeading() { return this; }
  setName(value) { this.name = value; return this; }
  setDesc(value) { this.description = value; return this; }
  add(kind, callback) {
    const control = new HostControl(kind);
    this.controls.push(control);
    callback(control);
    return this;
  }
  addDropdown(callback) { return this.add("dropdown", callback); }
  addToggle(callback) { return this.add("toggle", callback); }
  addSlider(callback) { return this.add("slider", callback); }
  addColorPicker(callback) { return this.add("color", callback); }
  addText(callback) { return this.add("text", callback); }
  addButton(callback) { return this.add("button", callback); }
}

const obsidianHost = {
  ItemView: class { constructor(leaf) { this.app = leaf.app; this.contentEl = new HostElement(); } },
  PluginSettingTab: class { constructor(app) { this.app = app; this.containerEl = new HostElement(); } hide() {} },
  Setting: HostSetting,
};
const projectRoot = path.resolve(__dirname, "..");
const result = esbuild.buildSync({
  stdin: {
    contents: [
      'export { GraphLinkTypesView, VIEW_TYPE } from "./src/graphView";',
      'export { GraphLinkTypesSettingTab } from "./src/settings";',
      'export { DEFAULT_SETTINGS, createLinkTypeConfig } from "./src/types";',
    ].join("\n"),
    resolveDir: projectRoot,
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "es2020",
  external: ["obsidian"],
  write: false,
  logLevel: "silent",
});
const compiled = new Module(path.join(__dirname, "settings.generated.cjs"), module);
compiled.filename = compiled.id;
compiled.paths = module.paths;
const nativeRequire = compiled.require.bind(compiled);
compiled.require = (id) => id === "obsidian" ? obsidianHost : nativeRequire(id);
compiled._compile(result.outputFiles[0].text, compiled.filename);
const { GraphLinkTypesView, GraphLinkTypesSettingTab, VIEW_TYPE, DEFAULT_SETTINGS, createLinkTypeConfig } = compiled.exports;

const copy = (value) => JSON.parse(JSON.stringify(value));
global.document = { activeElement: null };
function fixture(overrides = {}) {
  const settings = { ...copy(DEFAULT_SETTINGS), defaultMode: "2d", linkTypes: { rel: createLinkTypeConfig("#e6194b") }, ...overrides };
  const files = [{ path: "A.md", basename: "A" }, { path: "B.md", basename: "B" }];
  const notes = { "A.md": "rel:: [[B]]", "B.md": "" };
  const leaves = [];
  const caches = {};
  const opened = [];
  let reads = 0;
  const app = {
    workspace: {
      getLeavesOfType(type) { assert.equal(type, VIEW_TYPE); return leaves; },
      openLinkText(...args) { opened.push(args); },
    },
    vault: { getMarkdownFiles: () => files, async cachedRead(file) { reads++; return notes[file.path]; } },
    metadataCache: {
      getFileCache: (file) => caches[file.path] ?? null,
      getFirstLinkpathDest: (link) => files.find((file) => file.basename === link),
    },
  };
  const saved = [];
  const plugin = { settings, async saveSettings() { saved.push(copy(settings)); } };
  const view = new GraphLinkTypesView({ app }, settings, () => plugin.saveSettings());
  const calls = [];
  const selections = [];
  const selectionCalls = [];
  const renderer = (mode) => ({
    data: null,
    updateData(data) { this.data = data; calls.push({ mode, effect: "data", data }); },
    updateForces() { calls.push({ mode, effect: "force", charge: settings.chargeStrength, center: settings.centerForce }); },
    updateSettings() { calls.push({ mode, effect: "visual" }); },
    updateNodeGroups() { calls.push({ mode, effect: "groups" }); },
    setAnimate(running) { calls.push({ mode, effect: "animate", running }); },
    setSelectedRelation(id) {
      selectionCalls.push({ mode, id });
      if (view.currentMode === mode) selections.push(id);
    },
    getRelationDisplayCount(id) {
      const relation = this.data?.semantic?.relations.find(relation => relation.id === id);
      if (!relation) return null;
      const paths = new Set(this.data.nodes.map(node => node.relation?.sourcePath ?? node.id));
      return { displayed: relation.members.filter(member => paths.has(member)).length, total: relation.members.length };
    },
    destroy() {},
  });
  view.renderer2D = renderer("2d");
  view.renderer3D = renderer("3d");
  let sidebarRefreshes = 0;
  view.buildFilterPanel = () => { sidebarRefreshes++; };
  leaves.push({ view });
  const tab = new GraphLinkTypesSettingTab(app, plugin);
  tab.display();
  function control(name, kind = "slider", occurrence = 0) {
    const setting = tab.containerEl.settings.filter((setting) => setting.name === name)[occurrence];
    assert.ok(setting, `Missing setting ${name}`);
    const result = setting.controls.find((control) => control.kind === kind);
    assert.ok(result, `Missing ${kind} control for ${name}`);
    return result;
  }
  return { settings, view, tab, calls, control, saved, notes, files, caches, opened, selections, selectionCalls, reads: () => reads, sidebarRefreshes: () => sidebarRefreshes };
}

function realSidebar(f) {
  f.view.filterPanelEl = new HostElement();
  f.view.buildFilterPanel = GraphLinkTypesView.prototype.buildFilterPanel.bind(f.view);
  f.view.buildFilterPanel();
  return f.view.filterPanelEl;
}

function section(panel, title) {
  const header = panel.find((element) => element.cls === "gps-collapsible-header"
    && element.children.some((child) => child.text === " " + title));
  assert.ok(header, `Missing section ${title}`);
  const content = header.parentElement.children.find((child) => child.cls === "gps-collapsible-content");
  return { header, content };
}

test("profile JSON roundtrip restores semantic fields and clears an advanced rule added later", async () => {
  const f = fixture({ animate: false, chargeStrength: -640, centerForce: 0.4 });
  Object.assign(f.settings.linkTypes.rel, {
    color: "#4363d8", lineStyle: "dotted", widthMultiplier: 2.2,
    opacity: 0.35, arrowMode: "on", distanceMultiplier: 1.8, attraction: 0,
  });
  const expected = copy(f.settings.linkTypes.rel);
  const parent = new HostElement();
  f.view.buildProfileEditor(parent);
  parent.find((element) => element.placeholder === "Profile name").value = "semantic";
  await parent.find((element) => element.tag === "button" && element.text === "Save").fire("click");
  const stored = copy(f.settings.profiles[0]);
  assert.equal(Object.hasOwn(stored.snapshot.linkTypeConfig.rel, "forceRule"), false);
  Object.assign(f.settings.linkTypes.rel, {
    color: "#ffffff", lineStyle: "solid", widthMultiplier: 1,
    opacity: 1, arrowMode: "off", distanceMultiplier: 1, attraction: 2,
    forceRule: "down:1 distance:2x",
  });
  f.settings.chargeStrength = -120;
  f.settings.centerForce = 1;
  await f.view.loadProfile(stored);
  assert.deepEqual(copy(f.settings.linkTypes.rel), expected);
  assert.equal(f.settings.linkTypes.rel.forceRule, undefined);
  assert.equal(f.settings.chargeStrength, -640);
  assert.equal(f.settings.centerForce, 0.4);
  assert.deepEqual(stored.snapshot.linkTypeConfig.rel, expected, "Restoring must not mutate the snapshot");
  assert.equal(f.reads(), 2, "Rebuild uses the real parser and read-only vault API");
  const order = f.calls.filter((call) => call.mode === "2d").map((call) => call.effect);
  assert.deepEqual(order, ["force", "data", "visual"], "Paused layout needs restored forces before data settles");
});

test("legacy profile visibility and force rules preserve newer semantic settings", async () => {
  const f = fixture();
  Object.assign(f.settings.linkTypes.rel, { lineStyle: "dashed", attraction: 0.3, forceRule: "down:1" });
  await f.view.loadProfile({ name: "legacy", snapshot: { linkTypeConfig: { rel: { visible: false } } } });
  assert.equal(f.settings.linkTypes.rel.visible, false);
  assert.equal(f.settings.linkTypes.rel.lineStyle, "dashed");
  assert.equal(f.settings.linkTypes.rel.attraction, 0.3);
  assert.equal(f.settings.linkTypes.rel.forceRule, undefined);
});

test("settings-tab relationship controls update open renderers without rereading or resetting graph data", async () => {
  const f = fixture();
  await f.control("rel: distance").change(2.5);
  await f.control("rel: attraction").change(0);
  assert.equal(f.settings.linkTypes.rel.distanceMultiplier, 2.5);
  assert.equal(f.settings.linkTypes.rel.attraction, 0);
  assert.deepEqual(f.calls.map((call) => [call.mode, call.effect]), [
    ["2d", "force"], ["3d", "force"], ["2d", "force"], ["3d", "force"],
  ]);
  f.calls.length = 0;
  await f.control("rel: appearance", "dropdown").change("dotted");
  await f.control("rel: opacity").change(0.25);
  assert.deepEqual(f.calls.map((call) => [call.mode, call.effect]), [
    ["2d", "visual"], ["3d", "visual"], ["2d", "visual"], ["3d", "visual"],
  ]);
  assert.equal(f.reads(), 0);
  assert.equal(f.saved.length, 4);
  assert.equal(f.sidebarRefreshes(), 0, "Appearance and force changes sync existing controls without rebuilding menus");
});

test("settings-tab filtering and schema effects refresh an already-open graph", async () => {
  const f = fixture();
  await f.view.rebuildGraph();
  f.calls.length = 0;
  await f.control("rel", "toggle").change(false);
  assert.ok(f.calls.every((call) => call.effect === "data" && call.data.links.length === 0));
  f.calls.length = 0;
  await f.control("Pause physics", "toggle").change(true);
  assert.deepEqual(f.calls, [{ mode: "2d", effect: "animate", running: false }, { mode: "3d", effect: "animate", running: false }]);
  assert.equal(f.reads(), 2, "Settings changes reuse existing parsed graph data");
});

test("section expansion and scroll survive settings-tab and structural sidebar refreshes", async () => {
  const f = fixture({ nodeGroups: [{ query: "file:A", color: "#112233" }] });
  const panel = realSidebar(f);
  await section(panel, "Relationship Types").header.fire("click");
  await section(panel, "Groups").header.fire("click");
  panel.scrollTop = 280;
  await f.control("rel: opacity").change(0.4);
  assert.equal(section(panel, "Relationship Types").content.style.display, "none");
  assert.equal(section(panel, "Groups").content.style.display, "");
  assert.equal(panel.scrollTop, 280);
  f.settings.linkTypes.other = createLinkTypeConfig("#abcdef");
  f.view.refreshFilterPanel();
  assert.equal(section(panel, "Relationship Types").content.style.display, "none");
  assert.equal(section(panel, "Groups").content.style.display, "");
  assert.equal(panel.scrollTop, 280);
});

test("sidebar group query and color edits keep their inputs and recolor without vault reads or layout updates", async () => {
  const f = fixture({ nodeGroups: [{ query: "file:A", color: "#112233" }] });
  const panel = realSidebar(f);
  await section(panel, "Relationship Types").header.fire("click");
  await section(panel, "Groups").header.fire("click");
  panel.scrollTop = 250;
  const groupContent = section(panel, "Groups").content;
  const query = groupContent.find((element) => element.className === "gps-group-query-input");
  const color = groupContent.find((element) => element.type === "color");
  query.value = "file:B";
  await query.fire("change");
  color.value = "#abcdef";
  await color.fire("input");
  assert.equal(section(panel, "Groups").content, groupContent);
  assert.equal(groupContent.find((element) => element.type === "color"), color);
  assert.equal(groupContent.find((element) => element.className === "gps-group-query-input"), query);
  assert.equal(section(panel, "Relationship Types").content.style.display, "none");
  assert.equal(panel.scrollTop, 250);
  assert.deepEqual(f.settings.nodeGroups, [{ query: "file:B", color: "#abcdef" }]);
  assert.equal(f.reads(), 0);
  assert.deepEqual(f.calls.map((call) => call.effect), ["groups", "groups", "groups", "groups"]);
  await groupContent.find((element) => element.text === "+ Add group").fire("click");
  assert.equal(f.settings.nodeGroups.length, 2);
  assert.equal(section(panel, "Relationship Types").content.style.display, "none");
  assert.equal(section(panel, "Groups").content.style.display, "");
  assert.equal(panel.scrollTop, 250);
});

test("vault rebuilds update relationship counts without replacing an active group editor", async () => {
  const f = fixture({ nodeGroups: [{ query: "file:A", color: "#112233" }] });
  const panel = realSidebar(f);
  await f.view.rebuildGraph();
  const query = section(panel, "Groups").content.find((element) => element.className === "gps-group-query-input");
  document.activeElement = query;
  f.notes["B.md"] = "rel:: [[A]]";
  await f.view.rebuildGraph();
  assert.equal(section(panel, "Groups").content.find((element) => element.className === "gps-group-query-input"), query);
  assert.equal(f.view.linkCountEls.get("rel").textContent, "(2)");
  document.activeElement = null;
});

test("new relationship controls wait until relationship editing ends and retain navigation", async () => {
  const f = fixture({ nodeGroups: [{ query: "file:A", color: "#112233" }] });
  const panel = realSidebar(f);
  await section(panel, "Relationship Types").header.fire("click");
  await section(panel, "Groups").header.fire("click");
  panel.scrollTop = 250;
  const query = section(panel, "Groups").content.find((element) => element.className === "gps-group-query-input");
  document.activeElement = section(panel, "Relationship Types").content.find((element) => element.type === "number");
  f.notes["A.md"] += "\nother:: [[B]]";
  await f.view.rebuildGraph();
  assert.equal(f.view.sidebarRebuildPending, true);
  assert.equal(section(panel, "Groups").content.find((element) => element.className === "gps-group-query-input"), query);
  document.activeElement = null;
  f.view.refreshFilterPanel();
  assert.equal(f.view.sidebarRebuildPending, false);
  assert.ok(panel.find((element) => element.text === "other"));
  assert.equal(section(panel, "Relationship Types").content.style.display, "none");
  assert.equal(section(panel, "Groups").content.style.display, "");
  assert.equal(panel.scrollTop, 250);
  assert.equal(section(panel, "Groups").content.find((element) => element.className === "gps-group-query-input"), query);
});

test("new relationship types preserve a focused group editor and its next add action", async () => {
  const f = fixture({ nodeGroups: [{ query: "file:A", color: "#112233" }] });
  const panel = realSidebar(f);
  const groups = section(panel, "Groups");
  const query = groups.content.find((element) => element.className === "gps-group-query-input");
  const add = groups.content.find((element) => element.text === "+ Add group");
  document.activeElement = query;
  f.notes["A.md"] += "\nother:: [[B]]";
  await f.view.rebuildGraph();
  assert.ok(panel.find((element) => element.text === "other"));
  assert.equal(section(panel, "Groups").content, groups.content);
  assert.equal(panel.contains(query), true);
  assert.equal(panel.contains(add), true);
  await add.fire("click");
  assert.equal(f.settings.nodeGroups.length, 2);
  document.activeElement = null;
});

test("settings-tab group changes recolor open renderers without resetting their data", async () => {
  const f = fixture({ nodeGroups: [{ query: "file:A", color: "#112233" }] });
  const groupContainer = f.tab.containerEl.find((element) => element.settings.some((setting) => setting.name === "Group 1"));
  const group = groupContainer.settings.find((setting) => setting.name === "Group 1");
  await group.controls.find((control) => control.kind === "text").change("file:B");
  await group.controls.find((control) => control.kind === "color").change("#abcdef");
  assert.equal(f.reads(), 0);
  assert.deepEqual(f.calls.map((call) => call.effect), ["groups", "groups", "groups", "groups"]);
  assert.deepEqual(f.settings.nodeGroups, [{ query: "file:B", color: "#abcdef" }]);
});

function relationFixture(overrides = {}) {
  const f = fixture(overrides);
  f.files.push({ path: "C.md", basename: "C" }, { path: "Triad.md", basename: "Triad" });
  f.notes["C.md"] = "";
  f.notes["Triad.md"] = "[[A]] [[B]] [[C]]";
  f.caches["Triad.md"] = { frontmatter: {
    graph_kind: "relation", graph_id: "triad", relation_type: "alliance", ordered: false,
    members: ["[[A]]", "[[B]]", "[[C]]"],
  } };
  return f;
}

test("relation inspection retains full authored membership through filtering and opens the source note", async () => {
  const f = relationFixture();
  const panel = realSidebar(f);
  await section(panel, "Relationship Types").header.fire("click");
  await section(panel, "Groups").header.fire("click");
  await f.view.rebuildGraph();
  f.settings.searchQuery = "file:Triad";
  f.view.pushDataToRenderer();
  const displayed = f.calls.filter(call => call.mode === "2d" && call.effect === "data").at(-1).data;
  assert.equal(displayed.nodes.length, 1);
  assert.equal(displayed.links.length, 0);
  panel.style.display = "none";
  f.view.sidebarVisible = false;
  f.view.selectRelation(f.view.fullData.semantic.relations[0]);
  const content = section(panel, "Relations").content;
  const details = content.find(element => element.cls === "gps-relation-details");
  assert.equal(panel.style.display, "");
  assert.equal(content.style.display, "");
  assert.ok(details.find(element => element.text === "ID: triad"));
  assert.ok(details.find(element => element.text === "Type: alliance"));
  assert.deepEqual(details.find(element => element.tag === "ul").children.map(element => element.text), ["A.md", "B.md", "C.md"]);
  await details.find(element => element.text === "Open source note").fire("click");
  assert.deepEqual(f.opened, [["Triad.md", "", "tab"]]);
  assert.equal(section(panel, "Relationship Types").content.style.display, "none");
  assert.equal(section(panel, "Groups").content.style.display, "");
  panel.scrollTop = 200;
  const unchanged = section(panel, "Relations").content.children;
  await f.view.rebuildGraph();
  assert.strictEqual(section(panel, "Relations").content.children, unchanged, "Unchanged metadata does not rebuild the inspector");
  assert.equal(panel.scrollTop, 200);
});

test("independent projection toggles route only to their view and retain the standard note graph", async () => {
  const f = relationFixture();
  await f.view.rebuildGraph();
  const data2D = f.calls.find(call => call.mode === "2d" && call.effect === "data").data;
  const data3D = f.calls.find(call => call.mode === "3d" && call.effect === "data").data;
  assert.equal(data2D.nodes.filter(node => node.relation).length, 1);
  assert.ok(!data2D.nodes.some(node => node.id === "Triad.md"));
  assert.ok(!data3D.nodes.some(node => node.id === "Triad.md"));
  assert.equal(data3D.nodes.filter(node => node.relation).length, 1);
  assert.equal(data3D.links.filter(link => link.kind === "membership").length, 3);
  f.calls.length = 0;
  await f.control("Relationship junctions", "toggle").change(false);
  assert.deepEqual(f.calls.map(call => [call.mode, call.effect]), [["2d", "data"]]);
  assert.ok(f.calls[0].data.nodes.some(node => node.id === "Triad.md"));
  assert.equal(f.reads(), 4, "Projection toggling does not reread source notes");
  f.calls.length = 0;
  await f.control("Relationship junctions", "toggle", 1).change(false);
  assert.deepEqual(f.calls.map(call => [call.mode, call.effect]), [["3d", "data"]]);
  assert.ok(f.calls[0].data.nodes.some(node => node.id === "Triad.md"));
  assert.equal(f.calls[0].data.nodes.filter(node => node.relation).length, 0);
  assert.equal(f.calls[0].data.links.filter(link => link.kind === "membership").length, 3);
  f.view.renderer2D = null;
  f.calls.length = 0;
  await f.control("Relationship junctions", "toggle").change(true);
  assert.deepEqual(f.calls, [], "An open 3D layout is untouched by a 2D-only setting");
});

test("profiles restore the projection toggle with relationship settings after a JSON reload", async () => {
  const f = relationFixture();
  await f.view.rebuildGraph();
  f.settings.hypergraph2D = false;
  f.settings.hypergraph3D = false;
  Object.assign(f.settings.linkTypes.alliance, { attraction: 0.3, distanceMultiplier: 1.8, lineStyle: "dotted" });
  const parent = new HostElement();
  f.view.buildProfileEditor(parent);
  parent.find(element => element.placeholder === "Profile name").value = "standard";
  await parent.find(element => element.text === "Save").fire("click");
  const stored = copy(f.settings.profiles[0]);
  f.settings.hypergraph2D = true;
  f.settings.hypergraph3D = true;
  Object.assign(f.settings.linkTypes.alliance, { attraction: 2, distanceMultiplier: 1, lineStyle: "solid" });
  await f.view.loadProfile(stored);
  assert.equal(f.settings.hypergraph2D, false);
  assert.equal(f.settings.hypergraph3D, false);
  assert.equal(f.settings.linkTypes.alliance.attraction, 0.3);
  assert.equal(f.settings.linkTypes.alliance.distanceMultiplier, 1.8);
  assert.equal(f.settings.linkTypes.alliance.lineStyle, "dotted");
  assert.ok(f.calls.filter(call => call.mode === "2d" && call.effect === "data").at(-1).data.nodes.some(node => node.id === "Triad.md"));
  assert.ok(f.calls.filter(call => call.mode === "3d" && call.effect === "data").at(-1).data.nodes.some(node => node.id === "Triad.md"));
});

function sidebarControl(panel, label) {
  const row = panel.find(element => (element.cls === "gps-toggle-row" || element.cls === "gps-slider-row")
    && element.children.some(child => child.text === label));
  assert.ok(row, `Missing sidebar control ${label}`);
  return row.find(element => element.tag === "input");
}

test("region controls default off and redraw only 2D without replacing editors or opening menus", async () => {
  const f = fixture({ nodeGroups: [{ query: "file:A", color: "#112233" }] });
  const panel = realSidebar(f);
  const groupContent = section(panel, "Groups").content;
  const query = groupContent.find(element => element.className === "gps-group-query-input");
  await section(panel, "Relationship Types").header.fire("click");
  panel.scrollTop = 260;
  assert.equal(f.settings.hyperrelationRegions, false);
  assert.equal(f.settings.regionFillOpacity, 0.08);
  assert.deepEqual(f.control("Region fill opacity").limits, { min: 0, max: 0.3, step: 0.01 });
  const toggle = sidebarControl(panel, "Relationship regions");
  const slider = sidebarControl(panel, "Region fill opacity");
  assert.equal(toggle.disabled, false);
  assert.equal(slider.disabled, true);
  await f.control("Relationship regions", "toggle").change(true);
  await f.control("Region fill opacity").change(0.12);
  assert.equal(sidebarControl(panel, "Relationship regions"), toggle);
  assert.equal(sidebarControl(panel, "Region fill opacity"), slider);
  assert.equal(toggle.checked, true);
  assert.equal(slider.value, "0.12");
  assert.equal(slider.disabled, false);
  assert.equal(groupContent.find(element => element.className === "gps-group-query-input"), query);
  assert.equal(section(panel, "Relationship Types").content.style.display, "none");
  assert.equal(section(panel, "2D Display").content.style.display, "none");
  assert.equal(panel.scrollTop, 260);
  toggle.checked = false;
  await toggle.fire("change");
  assert.equal(f.settings.hyperrelationRegions, false);
  assert.equal(slider.disabled, true);
  assert.deepEqual(f.calls.map(call => [call.mode, call.effect]), [["2d", "visual"], ["2d", "visual"], ["2d", "visual"]]);
  assert.equal(f.reads(), 0);
  assert.deepEqual(f.opened, []);
  f.tab.hide();
});

test("region availability follows projection and mode in place in sidebar and open settings tab", async () => {
  const f = fixture({ hyperrelationRegions: true });
  const panel = realSidebar(f);
  const toggle = sidebarControl(panel, "Relationship regions");
  const slider = sidebarControl(panel, "Region fill opacity");
  const status = f.view.regionStatusEl;
  await f.control("Relationship junctions", "toggle").change(false);
  assert.equal(toggle.disabled, true);
  assert.equal(slider.disabled, true);
  assert.match(status.textContent, /unavailable in the standard graph/);
  assert.equal(f.control("Relationship regions", "toggle").disabled, true);
  await f.control("Relationship junctions", "toggle").change(true);
  assert.equal(toggle.disabled, false);
  assert.equal(slider.disabled, false);
  assert.equal(f.control("Relationship regions", "toggle").disabled, false);
  f.view.initRenderer = () => {};
  await f.view.modeBtnEl.fire("click");
  assert.equal(f.view.currentMode, "3d");
  assert.equal(sidebarControl(panel, "Relationship regions"), toggle);
  assert.equal(f.view.regionStatusEl, status);
  assert.match(status.textContent, /unavailable in 3D/);
  assert.equal(toggle.disabled, true);
  assert.equal(f.control("Relationship regions", "toggle").disabled, true);
  assert.match(f.tab.regionStatusEl.textContent, /unavailable in 3D/);
  await f.view.modeBtnEl.fire("click");
  assert.equal(toggle.disabled, false);
  assert.equal(f.control("Relationship regions", "toggle").disabled, false);
  assert.equal(f.settings.hyperrelationRegions, true, "Availability does not erase the saved preference");
  assert.equal(f.reads(), 0);
  f.tab.hide();
});

test("3D enclosures default off with independent fill and visual-only controls that retain editors and navigation", async () => {
  const f = fixture({ defaultMode: "3d", hyperrelationRegions: true, regionFillOpacity: 0.14,
    nodeGroups: [{ query: "file:A", color: "#112233" }] });
  const panel = realSidebar(f);
  const groupContent = section(panel, "Groups").content;
  const query = groupContent.find(element => element.className === "gps-group-query-input");
  await section(panel, "Relationship Types").header.fire("click");
  panel.scrollTop = 260;
  assert.equal(f.settings.hyperrelationEnclosures3D, false);
  assert.equal(f.settings.enclosureFillOpacity3D, 0.06);
  assert.deepEqual(f.control("Enclosure fill opacity").limits, { min: 0, max: 0.3, step: 0.01 });
  const toggle = sidebarControl(panel, "Relationship enclosures");
  const slider = sidebarControl(panel, "Enclosure fill opacity");
  assert.equal(toggle.disabled, false);
  assert.equal(slider.disabled, true);
  await f.control("Relationship enclosures", "toggle").change(true);
  await f.control("Enclosure fill opacity").change(0.12);
  assert.equal(sidebarControl(panel, "Relationship enclosures"), toggle);
  assert.equal(sidebarControl(panel, "Enclosure fill opacity"), slider);
  assert.equal(toggle.checked, true);
  assert.equal(slider.value, "0.12");
  assert.equal(slider.disabled, false);
  toggle.checked = false;
  await toggle.fire("change");
  assert.equal(f.settings.hyperrelationEnclosures3D, false);
  assert.equal(slider.disabled, true);
  assert.equal(f.settings.hyperrelationRegions, true);
  assert.equal(f.settings.regionFillOpacity, 0.14, "Spatial enclosures do not change the alternate 2D region preference");
  assert.equal(groupContent.find(element => element.className === "gps-group-query-input"), query);
  assert.equal(section(panel, "Relationship Types").content.style.display, "none");
  assert.equal(section(panel, "3D Display").content.style.display, "none");
  assert.equal(panel.scrollTop, 260);
  assert.deepEqual(f.calls.map(call => [call.mode, call.effect]), [["3d", "visual"], ["3d", "visual"], ["3d", "visual"]]);
  assert.equal(f.reads(), 0);
  assert.deepEqual(f.opened, []);
  f.tab.hide();
});

test("3D enclosure availability tracks junctions and view mode in existing sidebar and settings controls", async () => {
  const f = fixture({ defaultMode: "3d", hyperrelationEnclosures3D: true });
  const panel = realSidebar(f);
  const toggle = sidebarControl(panel, "Relationship enclosures");
  const slider = sidebarControl(panel, "Enclosure fill opacity");
  const status = f.view.enclosureStatusEl;
  assert.equal(toggle.disabled, false);
  assert.equal(slider.disabled, false);
  await f.control("Relationship junctions", "toggle", 1).change(false);
  assert.equal(toggle.disabled, true);
  assert.equal(slider.disabled, true);
  assert.equal(f.control("Relationship enclosures", "toggle").disabled, true);
  assert.match(status.textContent, /standard 3D graph/);
  await f.control("Relationship junctions", "toggle", 1).change(true);
  assert.equal(toggle.disabled, false);
  assert.equal(slider.disabled, false);
  f.view.initRenderer = () => {};
  await f.view.modeBtnEl.fire("click");
  assert.equal(f.view.currentMode, "2d");
  assert.equal(sidebarControl(panel, "Relationship enclosures"), toggle);
  assert.equal(f.view.enclosureStatusEl, status);
  assert.equal(toggle.disabled, true);
  assert.equal(slider.disabled, true);
  assert.equal(f.control("Relationship enclosures", "toggle").disabled, true);
  assert.match(status.textContent, /2D/);
  assert.match(f.tab.enclosureStatusEl.textContent, /2D/);
  await f.view.modeBtnEl.fire("click");
  assert.equal(toggle.disabled, false);
  assert.equal(slider.disabled, false);
  assert.equal(f.control("Relationship enclosures", "toggle").disabled, false);
  assert.equal(f.settings.hyperrelationEnclosures3D, true, "Unavailable contexts retain the saved spatial preference");
  assert.equal(f.reads(), 0);
  f.tab.hide();
});

test("3D enclosure profiles survive JSON reload and preserve paused data, inactive 2D preferences and editor closures", async () => {
  const saved = fixture({ defaultMode: "3d", animate: false, hyperrelationEnclosures3D: true,
    enclosureFillOpacity3D: 0.15, nodeGroups: [{ query: "file:A", color: "#112233" }] });
  const profileEditor = new HostElement();
  saved.view.buildProfileEditor(profileEditor);
  profileEditor.find(element => element.placeholder === "Profile name").value = "spatial enclosures";
  await profileEditor.find(element => element.text === "Save").fire("click");
  const persisted = copy(saved.saved.at(-1));
  assert.equal(persisted.profiles[0].snapshot.hyperrelationEnclosures3D, true);
  assert.equal(persisted.profiles[0].snapshot.enclosureFillOpacity3D, 0.15);
  const f = fixture({ ...persisted, hyperrelationEnclosures3D: false, enclosureFillOpacity3D: 0.06,
    hyperrelationRegions: true, regionFillOpacity: 0.2 });
  f.view.renderer2D = null;
  await f.view.rebuildGraph();
  const data = f.view.renderer3D.data, reads = f.reads();
  f.calls.length = 0;
  const panel = realSidebar(f);
  const groups = f.settings.nodeGroups;
  const content = section(panel, "Groups").content;
  const color = content.find(element => element.type === "color");
  await section(panel, "Relationship Types").header.fire("click");
  panel.scrollTop = 190;
  await f.view.loadProfile(f.settings.profiles[0]);
  assert.equal(f.settings.hyperrelationEnclosures3D, true);
  assert.equal(f.settings.enclosureFillOpacity3D, 0.15);
  assert.equal(f.settings.hyperrelationRegions, false);
  assert.equal(f.settings.regionFillOpacity, 0.08);
  assert.equal(f.settings.animate, false);
  assert.strictEqual(f.view.renderer3D.data, data);
  assert.equal(f.settings.nodeGroups, groups);
  assert.equal(section(panel, "Groups").content, content);
  assert.equal(section(panel, "Relationship Types").content.style.display, "none");
  assert.equal(panel.scrollTop, 190);
  assert.equal(sidebarControl(panel, "Enclosure fill opacity").value, "0.15");
  assert.equal(f.reads(), reads);
  assert.deepEqual(f.calls.map(call => [call.mode, call.effect]), [["3d", "visual"]]);
  color.value = "#abcdef";
  await color.fire("input");
  assert.equal(f.settings.nodeGroups[0].color, "#abcdef");
  await f.view.loadProfile({ name: "legacy", snapshot: { showNodeLabels: false } });
  assert.equal(f.settings.hyperrelationEnclosures3D, true, "Profiles without enclosure fields leave saved spatial preferences intact");
  assert.equal(f.settings.enclosureFillOpacity3D, 0.15);
  f.tab.hide(); saved.tab.hide();
});

test("region-only profiles survive JSON reload and preserve paused graph data and group editor closures", async () => {
  const saved = fixture({ animate: false, hyperrelationRegions: true, regionFillOpacity: 0.14, nodeGroups: [{ query: "file:A", color: "#112233" }] });
  const profileEditor = new HostElement();
  saved.view.buildProfileEditor(profileEditor);
  profileEditor.find(element => element.placeholder === "Profile name").value = "regions";
  await profileEditor.find(element => element.text === "Save").fire("click");
  const persisted = copy(saved.saved.at(-1));
  assert.equal(persisted.profiles[0].snapshot.hyperrelationRegions, true);
  assert.equal(persisted.profiles[0].snapshot.regionFillOpacity, 0.14);
  const f = fixture({ ...persisted, hyperrelationRegions: false, regionFillOpacity: 0.08 });
  const panel = realSidebar(f);
  const groups = f.settings.nodeGroups;
  const content = section(panel, "Groups").content;
  const color = content.find(element => element.type === "color");
  await section(panel, "Relationship Types").header.fire("click");
  panel.scrollTop = 190;
  await f.view.loadProfile(f.settings.profiles[0]);
  assert.equal(f.settings.hyperrelationRegions, true);
  assert.equal(f.settings.regionFillOpacity, 0.14);
  assert.equal(f.settings.animate, false);
  assert.equal(f.settings.nodeGroups, groups, "Equal groups retain the editor's captured array");
  assert.equal(section(panel, "Groups").content, content);
  assert.equal(section(panel, "Relationship Types").content.style.display, "none");
  assert.equal(panel.scrollTop, 190);
  assert.equal(sidebarControl(panel, "Region fill opacity").value, "0.14");
  assert.equal(f.reads(), 0);
  assert.deepEqual(f.calls.map(call => [call.mode, call.effect]), [["2d", "visual"]]);
  color.value = "#abcdef";
  await color.fire("input");
  assert.equal(f.settings.nodeGroups[0].color, "#abcdef");
  const legacy = { name: "old", snapshot: { showNodeLabels: false } };
  await f.view.loadProfile(legacy);
  assert.equal(f.settings.hyperrelationRegions, true, "Old profiles leave absent region fields unchanged");
  assert.equal(f.settings.regionFillOpacity, 0.14);
  f.tab.hide();
  saved.tab.hide();
});

test("relation selection reports filtered member counts including zero and keeps the complete authored list", async () => {
  const f = relationFixture();
  const panel = realSidebar(f);
  await section(panel, "Relationship Types").header.fire("click");
  await f.view.rebuildGraph();
  const relation = f.view.fullData.semantic.relations[0];
  f.view.selectRelation(relation);
  assert.deepEqual(f.selections, ["triad"]);
  let details = section(panel, "Relations").content.find(element => element.cls === "gps-relation-details");
  assert.ok(details.find(element => element.text === "Displayed members: 3 / 3"));
  f.settings.searchQuery = "file:A";
  f.view.pushDataToRenderer();
  details = section(panel, "Relations").content.find(element => element.cls === "gps-relation-details");
  assert.ok(details.find(element => element.text === "Displayed members: 1 / 3"));
  assert.deepEqual(details.find(element => element.tag === "ul").children.map(element => element.text), ["A.md", "B.md", "C.md"]);
  f.settings.searchQuery = "file:Triad";
  f.view.pushDataToRenderer();
  details = section(panel, "Relations").content.find(element => element.cls === "gps-relation-details");
  assert.ok(details.find(element => element.text === "Displayed members: 0 / 3"));
  assert.equal(section(panel, "Relationship Types").content.style.display, "none");
  await details.find(element => element.text === "Clear selection").fire("click");
  assert.deepEqual(f.selections, ["triad", null]);
  assert.deepEqual(f.opened, []);
  f.tab.hide();
});

test("invalid relation metadata clears inspector and renderer selection until explicitly selected again", async () => {
  const f = relationFixture();
  const panel = realSidebar(f);
  await f.view.rebuildGraph();
  f.view.selectRelation(f.view.fullData.semantic.relations[0]);
  f.caches["Triad.md"].frontmatter.ordered = true;
  await f.view.rebuildGraph();
  assert.equal(f.view.selectedRelationId, null);
  assert.deepEqual(f.selections, ["triad", null]);
  assert.equal(section(panel, "Relations").content.find(element => element.cls === "gps-relation-details"), undefined);
  f.view.refreshRelations();
  assert.deepEqual(f.selections, ["triad", null], "An invalid selection is cleared only once");
  f.caches["Triad.md"].frontmatter.ordered = false;
  await f.view.rebuildGraph();
  assert.equal(f.view.fullData.semantic.relations.length, 1);
  assert.equal(f.view.selectedRelationId, null);
  assert.equal(section(panel, "Relations").content.find(element => element.cls === "gps-relation-details"), undefined);
  assert.deepEqual(f.selections, ["triad", null], "Validity recovery does not silently select the relation");
  f.view.selectRelation(f.view.fullData.semantic.relations[0]);
  assert.deepEqual(f.selections, ["triad", null, "triad"]);
  assert.ok(section(panel, "Relations").content.find(element => element.cls === "gps-relation-details"));
  f.tab.hide();
});

test("new installs prefer 3D junctions while a persisted 2D preference is honored", () => {
  assert.equal(DEFAULT_SETTINGS.defaultMode, "3d");
  assert.equal(DEFAULT_SETTINGS.hypergraph3D, true);
  const f = fixture({ defaultMode: "2d", hypergraph3D: false });
  assert.equal(f.view.getCurrentMode(), "2d");
  assert.equal(f.settings.hypergraph3D, false);
  f.tab.hide();
});

test("3D inspection uses the complete authored relation with filtered counts, source opening and clear selection", async () => {
  const f = relationFixture({ defaultMode: "3d", animate: false });
  f.view.renderer2D = null;
  const panel = realSidebar(f);
  await section(panel, "Relationship Types").header.fire("click");
  panel.scrollTop = 220;
  await f.view.rebuildGraph();
  const relation = f.view.fullData.semantic.relations[0];
  f.view.selectRelation(relation);
  let details = section(panel, "Relations").content.find(element => element.cls === "gps-relation-details");
  assert.ok(details.find(element => element.text === "Displayed members: 3 / 3"));
  assert.deepEqual(f.selectionCalls, [{ mode: "3d", id: "triad" }]);
  f.settings.searchQuery = "-file:C";
  f.view.pushDataToRenderer();
  details = section(panel, "Relations").content.find(element => element.cls === "gps-relation-details");
  assert.ok(details.find(element => element.text === "Displayed members: 2 / 3"));
  assert.deepEqual(details.find(element => element.tag === "ul").children.map(element => element.text), ["A.md", "B.md", "C.md"]);
  assert.ok(details.find(element => element.text === "Type: alliance"));
  assert.ok(details.find(element => element.text === "Source: Triad.md"));
  await details.find(element => element.text === "Open source note").fire("click");
  assert.deepEqual(f.opened, [["Triad.md", "", "tab"]]);
  f.settings.searchQuery = "file:Triad";
  f.view.pushDataToRenderer();
  details = section(panel, "Relations").content.find(element => element.cls === "gps-relation-details");
  assert.ok(details.find(element => element.text === "Displayed members: 0 / 3"));
  assert.equal(section(panel, "Relationship Types").content.style.display, "none");
  assert.equal(panel.scrollTop, 220);
  await details.find(element => element.text === "Clear selection").fire("click");
  assert.deepEqual(f.selectionCalls, [{ mode: "3d", id: "triad" }, { mode: "3d", id: null }]);
  assert.ok(!section(panel, "Relations").content.find(element => element.cls === "gps-relation-details"));
  f.tab.hide();
});

test("pause settings and sidebar controls reach the active 3D renderer without rebuilding data or menus", async () => {
  const f = fixture({ defaultMode: "3d" });
  f.view.renderer2D = null;
  const panel = realSidebar(f);
  const types = section(panel, "Relationship Types").content;
  await section(panel, "Relationship Types").header.fire("click");
  panel.scrollTop = 200;
  const pause = sidebarControl(panel, "Pause physics");
  await f.control("Pause physics", "toggle").change(true);
  assert.equal(f.settings.animate, false);
  assert.equal(pause.checked, true);
  pause.checked = false;
  await pause.fire("change");
  assert.equal(f.settings.animate, true);
  assert.equal(section(panel, "Relationship Types").content, types);
  assert.equal(types.style.display, "none");
  assert.equal(panel.scrollTop, 200);
  assert.deepEqual(f.calls, [{ mode: "3d", effect: "animate", running: false }, { mode: "3d", effect: "animate", running: true }]);
  assert.equal(f.reads(), 0);
  f.tab.hide();
});

test("appearance-only 3D profiles survive JSON reload and keep paused data, inactive projection and editor objects intact", async () => {
  const f = fixture({ defaultMode: "3d", animate: false, nodeGroups: [{ query: "file:A", color: "#112233" }] });
  f.view.renderer2D = null;
  Object.assign(f.settings.linkTypes.rel, { color: "#42d4f4", widthMultiplier: 2, arrowMode: "on", lineStyle: "dotted", opacity: 0.25 });
  f.settings.linkOpacity = 0.4;
  const profileEditor = new HostElement();
  f.view.buildProfileEditor(profileEditor);
  profileEditor.find(element => element.placeholder === "Profile name").value = "3D appearance";
  await profileEditor.find(element => element.text === "Save").fire("click");
  const stored = copy(f.saved.at(-1).profiles[0]);
  assert.equal(stored.snapshot.hypergraph3D, true);
  Object.assign(f.settings.linkTypes.rel, { color: "#ffffff", widthMultiplier: 1, arrowMode: "off", lineStyle: "solid", opacity: 1 });
  f.settings.linkOpacity = 1;
  f.settings.hypergraph2D = false;
  const panel = realSidebar(f);
  const groups = f.settings.nodeGroups;
  const content = section(panel, "Groups").content;
  const query = content.find(element => element.className === "gps-group-query-input");
  await section(panel, "Relationship Types").header.fire("click");
  panel.scrollTop = 240;
  await f.view.loadProfile(stored);
  assert.equal(f.settings.hypergraph3D, true);
  assert.equal(f.settings.hypergraph2D, true, "Inactive 2D preference restores without rebuilding the active 3D projection");
  assert.equal(f.settings.linkTypes.rel.color, "#42d4f4");
  assert.equal(f.settings.linkTypes.rel.widthMultiplier, 2);
  assert.equal(f.settings.linkTypes.rel.arrowMode, "on");
  assert.equal(f.settings.linkTypes.rel.lineStyle, "dotted");
  assert.equal(f.settings.linkTypes.rel.opacity, 0.25);
  assert.equal(f.settings.linkOpacity, 0.4);
  assert.equal(f.settings.animate, false);
  assert.equal(f.settings.nodeGroups, groups);
  assert.equal(section(panel, "Groups").content, content);
  assert.equal(content.find(element => element.className === "gps-group-query-input"), query);
  assert.equal(section(panel, "Relationship Types").content.style.display, "none");
  assert.equal(panel.scrollTop, 240);
  assert.deepEqual(f.calls.map(call => [call.mode, call.effect]), [["3d", "visual"]]);
  assert.equal(f.reads(), 0, "Appearance restoration neither rereads notes nor resets renderer data");
  f.tab.hide();
});

test("3D-only contexts enable spatial patterns and opacity in sidebar and settings tab without replacing menus", async () => {
  const f = fixture({ defaultMode: "3d" });
  const panel = realSidebar(f);
  const grid = section(panel, "Relationship Types").content.find(element => element.cls === "gps-link-style-grid");
  const pattern = grid.children.find(element => element.children.some(child => child.text === "Style")).find(element => element.tag === "select");
  const opacity = grid.children.find(element => element.children.some(child => child.text === "Opacity")).find(element => element.tag === "input");
  const width = grid.children.find(element => element.children.some(child => child.text === "Width ×")).find(element => element.tag === "input");
  assert.notEqual(pattern.disabled, true);
  assert.notEqual(opacity.disabled, true);
  assert.notEqual(width.disabled, true);
  assert.notEqual(f.control("rel: appearance", "dropdown").disabled, true);
  assert.notEqual(f.control("rel: opacity").disabled, true);
  assert.notEqual(f.control("rel: width").disabled, true);
  assert.match(f.view.relationshipStyleStatusEl.textContent, /global Link opacity x type opacity/);
  assert.match(f.view.relationshipStyleStatusEl.textContent, /zero hides the connection and its arrows/);
  f.view.renderer2D = null;
  await f.control("rel: appearance", "dropdown").change("dashed");
  await f.control("rel: opacity").change(0);
  assert.deepEqual(f.calls.map(call => [call.mode, call.effect]), [["3d", "visual"], ["3d", "visual"]]);
  assert.equal(f.settings.linkTypes.rel.lineStyle, "dashed");
  assert.equal(f.settings.linkTypes.rel.opacity, 0);
  assert.equal(section(panel, "Relationship Types").content.find(element => element.cls === "gps-link-style-grid"), grid);
  assert.equal(f.reads(), 0);
  f.view.initRenderer = () => {};
  await f.view.modeBtnEl.fire("click");
  assert.notEqual(pattern.disabled, true);
  assert.notEqual(opacity.disabled, true);
  assert.notEqual(f.control("rel: appearance", "dropdown").disabled, true);
  assert.notEqual(f.control("rel: opacity").disabled, true);
  f.tab.hide();
});

test("3D invalid metadata clears selection once and recovery requires explicit reselection", async () => {
  const f = relationFixture({ defaultMode: "3d" });
  f.view.renderer2D = null;
  const panel = realSidebar(f);
  await f.view.rebuildGraph();
  f.view.selectRelation(f.view.fullData.semantic.relations[0]);
  f.caches["Triad.md"].frontmatter.ordered = true;
  await f.view.rebuildGraph();
  f.view.refreshRelations();
  assert.equal(f.view.selectedRelationId, null);
  assert.deepEqual(f.selectionCalls, [{ mode: "3d", id: "triad" }, { mode: "3d", id: null }]);
  f.caches["Triad.md"].frontmatter.ordered = false;
  await f.view.rebuildGraph();
  assert.equal(f.view.selectedRelationId, null);
  assert.ok(!section(panel, "Relations").content.find(element => element.cls === "gps-relation-details"));
  f.view.selectRelation(f.view.fullData.semantic.relations[0]);
  assert.deepEqual(f.selectionCalls.at(-1), { mode: "3d", id: "triad" });
  f.tab.hide();
});
